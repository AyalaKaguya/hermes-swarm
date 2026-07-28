import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { RuntimeQueueOutbox2026072500006 } from "./migrations/2026072500006-RuntimeQueueOutbox.js";

describe("Runtime queue and outbox migration", () => {
  it("creates workspace-bound runs and minimal durable dispatches", async () => {
    const statements: string[] = [];
    await new RuntimeQueueOutbox2026072500006().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);

    const sql = statements.join("\n");
    assert.match(sql, /CREATE TABLE "runtime_runs"/);
    assert.match(sql, /CREATE TABLE "runtime_outbox_messages"/);
    assert.match(
      sql,
      /UNIQUE \("workspace_id", "run_kind", "idempotency_key"\)/,
    );
    assert.match(sql, /UNIQUE \("workspace_id", "id"\)/);
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "run_id"\)[\s\S]*REFERENCES "runtime_runs"\("workspace_id", "id"\) ON DELETE RESTRICT/,
    );
    assert.match(sql, /CHK_runtime_runs_lease_shape/);
    assert.match(sql, /CHK_runtime_runs_running_lease/);
    assert.match(
      sql,
      /'cancelled', 'cancelling', 'failed', 'queued',[\s\S]*'running', 'succeeded', 'timedOut', 'waiting'/,
    );
    assert.match(
      sql,
      /"status" IN \('succeeded', 'failed', 'cancelled', 'timedOut'\)[\s\S]*"finished_at" IS NOT NULL/,
    );
    assert.match(
      sql,
      /"status" IN \('queued', 'running', 'cancelling', 'waiting'\)[\s\S]*"finished_at" IS NULL/,
    );
    assert.match(sql, /CHK_runtime_outbox_publishing_lease/);
    assert.match(sql, /CHK_runtime_outbox_published_state/);
    assert.match(sql, /IDX_runtime_runs_dispatch_scan/);
    assert.match(sql, /IDX_runtime_outbox_dispatch_scan/);
    assert.match(sql, /IDX_2c05a754cd252145bebf8084a9/);
    assert.match(sql, /IDX_103b777ca5770c6b250ece0d42/);
    assert.match(sql, /IDX_runtime_outbox_published_reconcile/);
    assert.match(
      sql,
      /IDX_runtime_runs_dispatch_scan[\s\S]*WHERE "status" IN \('queued', 'running', 'cancelling'\)/,
    );
    assert.match(
      sql,
      /IDX_runtime_outbox_dispatch_scan[\s\S]*WHERE "status" IN \('pending', 'publishing'\)/,
    );
    assert.match(
      sql,
      /IDX_runtime_outbox_published_reconcile[\s\S]*\("published_at", "id"\)[\s\S]*WHERE "status" = 'published'/,
    );
    assert.match(
      sql,
      /"payload" \?& ARRAY\['schemaVersion', 'dispatchId', 'runId'\]/,
    );
    assert.match(
      sql,
      /\("payload" - 'schemaVersion' - 'dispatchId' - 'runId'\) = '\{\}'::jsonb/,
    );
    assert.match(sql, /"payload"->>'dispatchId' = "id"::text/);
    assert.match(sql, /"payload"->>'runId' = "run_id"::text/);
    assert.doesNotMatch(
      sql,
      /executionScope|workspaceId[^"']|secret|messageBody|ROW LEVEL SECURITY|CREATE POLICY|current_setting|set_config/i,
    );
  });

  it("refuses a destructive rollback", async () => {
    await assert.rejects(
      () => new RuntimeQueueOutbox2026072500006().down(),
      /cannot be rolled back safely/,
    );
  });
});
