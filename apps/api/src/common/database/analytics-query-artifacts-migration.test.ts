import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnalyticsQueryArtifacts2026072600001 } from "./migrations/2026072600001-AnalyticsQueryArtifacts.js";

describe("AnalyticsQueryArtifacts2026072600001", () => {
  it("creates workspace-anchored query runs and private dataset artifacts", async () => {
    const statements: Array<{ parameters?: unknown[]; sql: string }> = [];
    await new AnalyticsQueryArtifacts2026072600001().up({
      query: async (statement: string, parameters?: unknown[]) => {
        statements.push({
          parameters,
          sql: statement.replace(/\s+/g, " ").trim(),
        });
      },
    } as never);

    const sql = statements.map((statement) => statement.sql).join("\n");
    assert.match(sql, /CREATE TABLE "analysis_query_runs"/);
    assert.match(sql, /CREATE TABLE "dataset_artifacts"/);
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "id"\) REFERENCES "runtime_runs"\("workspace_id", "id"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "integration_token_id"\) REFERENCES "integration_tokens"\("workspace_id", "id"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "query_run_id"\) REFERENCES "analysis_query_runs"\("workspace_id", "id"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "file_object_id"\) REFERENCES "file_objects"\("workspace_id", "id"\)/,
    );
    assert.match(sql, /CHK_analysis_query_runs_principal/);
    assert.match(sql, /CHK_analysis_query_runs_terminal_state/);
    assert.match(sql, /CHK_dataset_artifacts_ready_state/);
    assert.match(sql, /UQ_dataset_artifacts_workspace_query_run/);
    assert.match(sql, /UQ_dataset_artifacts_workspace_file_object/);
    assert.match(
      sql,
      /IDX_dataset_artifacts_expiration[\s\S]*"status" IN \('failed', 'pending', 'ready'\)/,
    );
    const parameters = statements.flatMap(
      (statement) => statement.parameters ?? [],
    );
    for (const permission of [
      "analytics.ticket_dataset.query_run_submit:workspace",
      "analytics.ticket_dataset.query_run_read:workspace",
      "analytics.ticket_dataset.query_run_cancel:workspace",
      "analytics.ticket_dataset.query_run_result:workspace",
      "analytics.ticket_dataset.artifact_download:workspace",
    ]) {
      assert.ok(parameters.includes(permission));
    }
    assert.match(sql, /INSERT INTO "role_permissions"/);
    assert.match(sql, /"role"\."scope" = 'workspace'/);
    assert.doesNotMatch(sql, /ROW LEVEL SECURITY|CREATE POLICY|set_config/i);
  });

  it("declares rollback unsafe", async () => {
    await assert.rejects(
      () => new AnalyticsQueryArtifacts2026072600001().down(),
      /cannot be rolled back safely/,
    );
  });
});
