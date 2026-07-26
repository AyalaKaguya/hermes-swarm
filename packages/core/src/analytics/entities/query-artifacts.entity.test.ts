import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import {
  ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
  AnalysisQueryRun,
} from "./analysis-query-run.entity.js";
import {
  DATASET_ARTIFACT_SCHEMA_VERSION,
  DatasetArtifact,
} from "./dataset-artifact.entity.js";

describe("analytics query artifact entity metadata", () => {
  it("registers versioned query-run and dataset-artifact tables", () => {
    const metadata = getMetadataArgsStorage();
    assert.equal(
      metadata.tables.find((item) => item.target === AnalysisQueryRun)?.name,
      "analysis_query_runs",
    );
    assert.equal(
      metadata.tables.find((item) => item.target === DatasetArtifact)?.name,
      "dataset_artifacts",
    );

    const schemaVersion = (entity: Function) =>
      metadata.columns.find(
        (item) =>
          item.target === entity && item.propertyName === "schemaVersion",
      );
    assert.equal(
      schemaVersion(AnalysisQueryRun)?.options.default,
      ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
    );
    assert.equal(
      schemaVersion(DatasetArtifact)?.options.default,
      DATASET_ARTIFACT_SCHEMA_VERSION,
    );
  });

  it("anchors every workspace-owned foreign key with workspace_id", () => {
    const joins = getMetadataArgsStorage().joinColumns;
    const relationColumns = (entity: Function, propertyName: string) =>
      joins
        .filter(
          (column) =>
            column.target === entity && column.propertyName === propertyName,
        )
        .map((column) => [column.name, column.referencedColumnName]);

    assert.deepEqual(relationColumns(AnalysisQueryRun, "runtimeRun"), [
      ["workspace_id", "workspaceId"],
      ["id", "id"],
    ]);
    assert.deepEqual(relationColumns(AnalysisQueryRun, "integrationToken"), [
      ["workspace_id", "workspaceId"],
      ["integration_token_id", "id"],
    ]);
    assert.deepEqual(relationColumns(DatasetArtifact, "queryRun"), [
      ["workspace_id", "workspaceId"],
      ["query_run_id", "id"],
    ]);
    assert.deepEqual(relationColumns(DatasetArtifact, "fileObject"), [
      ["workspace_id", "workspaceId"],
      ["file_object_id", "id"],
    ]);
  });

  it("enforces one artifact per run and one artifact per file", () => {
    const indices = getMetadataArgsStorage().indices;
    const expected = new Map<string, readonly string[]>([
      ["UQ_analysis_query_runs_workspace_id", ["workspaceId", "id"]],
      ["UQ_dataset_artifacts_workspace_id", ["workspaceId", "id"]],
      [
        "UQ_dataset_artifacts_workspace_query_run",
        ["workspaceId", "queryRunId"],
      ],
      [
        "UQ_dataset_artifacts_workspace_file_object",
        ["workspaceId", "fileObjectId"],
      ],
    ]);
    for (const [name, columns] of expected) {
      const index = indices.find((item) => item.name === name);
      assert.ok(index, `${name} must exist`);
      assert.equal(index.unique, true);
      assert.deepEqual(index.columns, columns);
    }
    assert.match(
      String(
        indices.find(
          (item) =>
            item.name === "UQ_dataset_artifacts_workspace_file_object",
        )?.where,
      ),
      /file_object_id.*IS NOT NULL/,
    );
    assert.match(
      String(
        indices.find(
          (item) => item.name === "IDX_dataset_artifacts_expiration",
        )?.where,
      ),
      /'failed'.*'pending'.*'ready'/,
    );
  });

  it("keeps staged fields nullable and guards lifecycle shapes", () => {
    const metadata = getMetadataArgsStorage();
    for (const [entity, propertyNames] of [
      [
        AnalysisQueryRun,
        ["integrationTokenId", "policyDigest", "inlineResult", "startedAt"],
      ],
      [
        DatasetArtifact,
        ["fileObjectId", "lineage", "preview", "resultSchema", "readyAt"],
      ],
    ] as const) {
      for (const propertyName of propertyNames) {
        const column = metadata.columns.find(
          (item) =>
            item.target === entity && item.propertyName === propertyName,
        );
        assert.equal(column?.options.nullable, true, propertyName);
      }
    }

    const checks = metadata.checks;
    for (const name of [
      "CHK_analysis_query_runs_inline_result",
      "CHK_analysis_query_runs_principal",
      "CHK_analysis_query_runs_status",
      "CHK_analysis_query_runs_terminal_state",
      "CHK_dataset_artifacts_preview",
      "CHK_dataset_artifacts_ready_state",
      "CHK_dataset_artifacts_schema_version",
      "CHK_dataset_artifacts_status",
    ]) {
      assert.ok(checks.some((item) => item.name === name), `${name} must exist`);
    }
    assert.match(
      String(
        checks.find(
          (item) => item.name === "CHK_dataset_artifacts_ready_state",
        )?.expression,
      ),
      /expired/,
    );
  });
});
