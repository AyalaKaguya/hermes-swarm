import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { RuntimeRunEvents2026072500007 } from "./migrations/2026072500007-RuntimeRunEvents.js";

describe("Runtime Run events migration", () => {
  it("creates an immutable workspace-bound ordered event stream", async () => {
    const statements: string[] = [];
    await new RuntimeRunEvents2026072500007().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);

    const sql = statements.join("\n");
    assert.match(
      sql,
      /ADD COLUMN "event_sequence" integer NOT NULL DEFAULT 0/,
    );
    assert.match(
      sql,
      /CHK_runtime_runs_event_sequence[\s\S]*"event_sequence" >= 0/,
    );
    assert.match(sql, /CREATE TABLE "runtime_run_events"/);
    assert.match(
      sql,
      /UNIQUE \("workspace_id", "run_id", "sequence"\)/,
    );
    assert.match(
      sql,
      /UNIQUE \("workspace_id", "run_id", "event_key"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "run_id"\)[\s\S]*REFERENCES "runtime_runs"\("workspace_id", "id"\) ON DELETE RESTRICT/,
    );
    assert.match(sql, /CHK_runtime_run_events_sequence/);
    assert.match(sql, /CHK_runtime_run_events_schema_version/);
    assert.match(sql, /"schema_version" = 'hermes\.run-event\/v1'/);
    assert.match(sql, /CHK_runtime_run_events_event_key/);
    assert.match(sql, /CHK_runtime_run_events_node_id/);
    assert.match(sql, /CHK_runtime_run_events_payload/);
    assert.match(sql, /jsonb_typeof\("payload"\) = 'object'/);
    assert.match(sql, /'run\.status\.changed'/);
    assert.match(sql, /IDX_da295429542592f0b206eb05cb/);
    assert.match(sql, /TR_runtime_run_events_immutable/);
    assert.match(
      sql,
      /BEFORE UPDATE OR DELETE ON "runtime_run_events"/,
    );
    assert.doesNotMatch(
      sql,
      /ROW LEVEL SECURITY|CREATE POLICY|current_setting|set_config/i,
    );
  });

  it("refuses a destructive rollback", async () => {
    await assert.rejects(
      () => new RuntimeRunEvents2026072500007().down(),
      /cannot be rolled back safely/,
    );
  });
});
