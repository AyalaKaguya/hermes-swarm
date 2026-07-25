import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { RuntimeCheckpoints2026072500008 } from "./migrations/2026072500008-RuntimeCheckpoints.js";

describe("Runtime checkpoints migration", () => {
  it("creates workspace-bound versioned checkpoint lineage", async () => {
    const sql = await migrationSql();

    assert.match(sql, /CREATE TABLE "runtime_checkpoints"/);
    assert.match(sql, /"workspace_id" uuid NOT NULL/);
    assert.match(
      sql,
      /"namespace" character varying\(500\) NOT NULL DEFAULT ''/,
    );
    assert.match(sql, /"checkpoint_key" uuid NOT NULL/);
    assert.match(sql, /"parent_checkpoint_id" uuid/);
    assert.match(sql, /"lease_generation" integer NOT NULL/);
    assert.match(sql, /"state_digest" character\(64\) NOT NULL/);
    assert.match(sql, /UNIQUE \("workspace_id", "id"\)/);
    assert.match(
      sql,
      /UNIQUE \("workspace_id", "run_id", "id"\)/,
    );
    assert.match(
      sql,
      /UNIQUE \("workspace_id", "run_id", "sequence"\)/,
    );
    assert.match(
      sql,
      /UNIQUE \("workspace_id", "run_id", "namespace", "checkpoint_key"\)/,
    );
    assert.match(
      sql,
      /UNIQUE \("workspace_id", "run_id", "namespace", "idempotency_key"\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "run_id"\)[\s\S]*REFERENCES "runtime_runs"\("workspace_id", "id"\) ON DELETE RESTRICT/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "run_id", "parent_checkpoint_id"\)[\s\S]*REFERENCES "runtime_checkpoints"\("workspace_id", "run_id", "id"\)[\s\S]*ON DELETE RESTRICT/,
    );
    assert.match(sql, /CHK_runtime_checkpoints_sequence/);
    assert.match(sql, /CHECK \("sequence" > 0\)/);
    assert.match(sql, /CHK_runtime_checkpoints_lease_generation/);
    assert.match(sql, /CHK_runtime_checkpoints_namespace/);
    assert.match(sql, /\{0,500\}/);
    assert.match(sql, /CHK_runtime_checkpoints_schema_version/);
    assert.match(sql, /hermes\.graph-checkpoint\/v1/);
    assert.match(sql, /CHK_runtime_checkpoints_state_digest/);
    assert.match(sql, /'\^\[a-f0-9\]\{64\}\$'/);
    assert.match(sql, /IDX_3b5688feb2ec5571296db5b0e3/);
  });

  it("stores the exact SDK adapter descriptor with arbitrary JSON state", async () => {
    const sql = await migrationSql();

    assert.match(sql, /CHK_runtime_checkpoints_adapter_state/);
    assert.match(
      sql,
      /"adapter_state" \?& ARRAY\['adapter', 'state'\]/,
    );
    assert.match(
      sql,
      /\("adapter_state"->'adapter'\)[\s\S]*\?& ARRAY\['kind', 'checkpointVersion'\]/,
    );
    assert.match(
      sql,
      /"adapter_state"->'adapter'->>'kind'[\s\S]*\^\[a-z\]/,
    );
    assert.match(
      sql,
      /"adapter_state"->'adapter'->>'checkpointVersion'/,
    );
    assert.doesNotMatch(
      sql,
      /jsonb_typeof\("adapter_state"->'state'\) = 'object'/,
    );
  });

  it("serializes each Run's next sequence and scopes retry keys by namespace", async () => {
    const sql = await migrationSql();

    assert.match(sql, /enforce_runtime_checkpoint_sequence/);
    assert.match(
      sql,
      /FROM "runtime_runs"[\s\S]*"workspace_id" = NEW\."workspace_id"[\s\S]*"id" = NEW\."run_id"[\s\S]*FOR UPDATE/,
    );
    assert.match(
      sql,
      /"namespace" = NEW\."namespace"[\s\S]*"idempotency_key" = NEW\."idempotency_key"[\s\S]*OR "checkpoint_key" = NEW\."checkpoint_key"/,
    );
    assert.match(sql, /COALESCE\(MAX\("sequence"\), 0\)/);
    assert.match(sql, /NEW\."sequence" <> latest_sequence \+ 1/);
    assert.match(sql, /TR_runtime_checkpoints_monotonic_sequence/);
    assert.match(sql, /BEFORE INSERT ON "runtime_checkpoints"/);
  });

  it("persists typed idempotent pending writes for checkpoint recovery", async () => {
    const sql = await migrationSql();

    assert.match(sql, /CREATE TABLE "runtime_checkpoint_writes"/);
    assert.match(
      sql,
      /UNIQUE \([\s\S]*"workspace_id", "run_id", "checkpoint_id", "task_id", "write_index"[\s\S]*\)/,
    );
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "run_id", "checkpoint_id"\)[\s\S]*REFERENCES "runtime_checkpoints"\("workspace_id", "run_id", "id"\)[\s\S]*ON DELETE RESTRICT/,
    );
    assert.match(sql, /"channel" character varying\(128\) NOT NULL/);
    assert.match(sql, /"type" character varying\(32\) NOT NULL/);
    assert.match(sql, /"value" jsonb NOT NULL/);
    assert.match(sql, /CHK_runtime_checkpoint_writes_task_id/);
    assert.match(sql, /CHK_runtime_checkpoint_writes_channel/);
    assert.match(sql, /CHK_runtime_checkpoint_writes_type/);
    assert.match(sql, /CHK_runtime_checkpoint_writes_value/);
    assert.doesNotMatch(sql, /CHECK \("write_index" >= 0\)/);
    assert.match(sql, /IDX_27ee9790ee0af1f5d6c0df98fe/);
  });

  it("keeps checkpoints immutable and only replaces negative-index write values", async () => {
    const sql = await migrationSql();
    const migration = new RuntimeCheckpoints2026072500008();

    assert.match(sql, /TR_runtime_checkpoints_immutable/);
    assert.match(
      sql,
      /BEFORE UPDATE OR DELETE ON "runtime_checkpoints"/,
    );
    assert.match(sql, /enforce_runtime_checkpoint_write_mutation/);
    assert.match(sql, /OLD\."write_index" >= 0/);
    for (const identity of [
      "id",
      "created_at",
      "workspace_id",
      "run_id",
      "checkpoint_id",
      "task_id",
      "write_index",
      "channel",
    ]) {
      assert.match(
        sql,
        new RegExp(
          `NEW\\."${identity}" IS DISTINCT FROM OLD\\."${identity}"`,
        ),
      );
    }
    assert.match(sql, /TR_runtime_checkpoint_writes_controlled_mutation/);
    assert.match(
      sql,
      /BEFORE UPDATE OR DELETE ON "runtime_checkpoint_writes"/,
    );
    assert.doesNotMatch(
      sql,
      /ROW LEVEL SECURITY|CREATE POLICY|current_setting|set_config/i,
    );
    await assert.rejects(
      () => migration.down(),
      /cannot be rolled back safely/,
    );
  });
});

async function migrationSql() {
  const statements: string[] = [];
  await new RuntimeCheckpoints2026072500008().up({
    query: async (sql: string) => {
      statements.push(sql);
      return undefined;
    },
  } as unknown as QueryRunner);
  return statements.join("\n");
}
