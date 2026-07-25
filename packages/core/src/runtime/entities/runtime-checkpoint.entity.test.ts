import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { RuntimeCheckpoint } from "./runtime-checkpoint.entity.js";
import { RuntimeCheckpointWrite } from "./runtime-checkpoint-write.entity.js";

describe("Runtime checkpoint entities", () => {
  it("registers immutable checkpoints and stable pending-write identities", () => {
    const metadata = getMetadataArgsStorage();
    const tables = new Map(
      metadata.tables.map((candidate) => [candidate.target, candidate.name]),
    );

    assert.equal(tables.get(RuntimeCheckpoint), "runtime_checkpoints");
    assert.equal(
      tables.get(RuntimeCheckpointWrite),
      "runtime_checkpoint_writes",
    );
    const workspaceId = metadata.columns.find(
      (column) =>
        column.propertyName === "workspaceId" &&
        column.target.name === "WorkspaceOwnedBaseEntity",
    );
    assert.notEqual(workspaceId?.options.nullable, true);

    const immutable = new Map<Function, readonly string[]>([
      [
        RuntimeCheckpoint,
        [
          "adapterCheckpointKey",
          "adapterState",
          "idempotencyKey",
          "leaseGeneration",
          "namespace",
          "parentCheckpointId",
          "runId",
          "schemaVersion",
          "sequence",
          "stateDigest",
        ],
      ],
      [
        RuntimeCheckpointWrite,
        [
          "channel",
          "checkpointId",
          "runId",
          "taskId",
          "writeIndex",
        ],
      ],
    ]);
    for (const [entity, properties] of immutable) {
      const columns = metadata.columns.filter(
        (column) =>
          column.target === entity && properties.includes(column.propertyName),
      );
      assert.equal(columns.length, properties.length);
      for (const column of columns) {
        assert.equal(column.options.update, false, column.propertyName);
      }
    }

    for (const propertyName of ["type", "value"]) {
      const column = metadata.columns.find(
        (candidate) =>
          candidate.target === RuntimeCheckpointWrite &&
          candidate.propertyName === propertyName,
      );
      assert.ok(column, propertyName);
      assert.notEqual(column.options.update, false, propertyName);
    }
  });

  it("orders and deduplicates checkpoints and pending writes inside one Run", () => {
    const indices = getMetadataArgsStorage().indices;
    const expected = new Map<string, readonly string[]>([
      ["UQ_runtime_checkpoints_workspace_id", ["workspaceId", "id"]],
      [
        "UQ_runtime_checkpoints_workspace_run_id",
        ["workspaceId", "runId", "id"],
      ],
      [
        "UQ_runtime_checkpoints_workspace_run_sequence",
        ["workspaceId", "runId", "sequence"],
      ],
      [
        "UQ_runtime_checkpoints_workspace_run_namespace_checkpoint_key",
        ["workspaceId", "runId", "namespace", "adapterCheckpointKey"],
      ],
      [
        "UQ_runtime_checkpoints_workspace_run_namespace_idempotency_key",
        ["workspaceId", "runId", "namespace", "idempotencyKey"],
      ],
      [
        "UQ_runtime_checkpoint_writes_workspace_id",
        ["workspaceId", "id"],
      ],
      [
        "UQ_runtime_checkpoint_writes_identity",
        ["workspaceId", "runId", "checkpointId", "taskId", "writeIndex"],
      ],
    ]);

    for (const [name, columns] of expected) {
      const index = indices.find((candidate) => candidate.name === name);
      assert.ok(index, `${name} must exist`);
      assert.equal(index.unique, true);
      assert.deepEqual(index.columns, columns);
    }
  });

  it("uses workspace-composite foreign keys for Runs and checkpoints", () => {
    const joins = getMetadataArgsStorage().joinColumns;
    const relationColumns = (entity: Function, propertyName: string) =>
      joins
        .filter(
          (column) =>
            column.target === entity && column.propertyName === propertyName,
        )
        .map((column) => [column.name, column.referencedColumnName]);

    assert.deepEqual(relationColumns(RuntimeCheckpoint, "run"), [
      ["workspace_id", "workspaceId"],
      ["run_id", "id"],
    ]);
    assert.deepEqual(
      relationColumns(RuntimeCheckpoint, "parentCheckpoint"),
      [
        ["workspace_id", "workspaceId"],
        ["run_id", "runId"],
        ["parent_checkpoint_id", "id"],
      ],
    );
    assert.deepEqual(
      relationColumns(RuntimeCheckpointWrite, "checkpoint"),
      [
        ["workspace_id", "workspaceId"],
        ["run_id", "runId"],
        ["checkpoint_id", "id"],
      ],
    );
  });

  it("represents bounded version, identity, adapter, and write checks", () => {
    const checks = getMetadataArgsStorage().checks;
    for (const name of [
      "CHK_runtime_checkpoints_adapter_state",
      "CHK_runtime_checkpoints_idempotency_key",
      "CHK_runtime_checkpoints_lease_generation",
      "CHK_runtime_checkpoints_namespace",
      "CHK_runtime_checkpoints_schema_version",
      "CHK_runtime_checkpoints_sequence",
      "CHK_runtime_checkpoints_state_digest",
      "CHK_runtime_checkpoint_writes_channel",
      "CHK_runtime_checkpoint_writes_task_id",
      "CHK_runtime_checkpoint_writes_type",
      "CHK_runtime_checkpoint_writes_value",
    ]) {
      assert.ok(
        checks.some((check) => check.name === name),
        `${name} must be represented`,
      );
    }
    const checkpointChecks = checks.filter(
      (check) => check.target === RuntimeCheckpoint,
    );
    assert.match(
      String(
        checkpointChecks.find(
          (check) => check.name === "CHK_runtime_checkpoints_schema_version",
        )?.expression,
      ),
      /hermes\.graph-checkpoint\/v1/,
    );
    assert.match(
      String(
        checkpointChecks.find(
          (check) => check.name === "CHK_runtime_checkpoints_adapter_state",
        )?.expression,
      ),
      /checkpointVersion/,
    );
  });
});
