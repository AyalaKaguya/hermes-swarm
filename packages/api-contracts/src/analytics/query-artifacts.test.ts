import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ANALYTICS_QUERY_VERSION, ANALYTICS_RESULT_VERSION } from "./constants.js";
import {
  ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
  AnalysisQueryResultSchema,
  AnalysisQueryRunParamsSchema,
  AnalysisQueryRunSchema,
  AnalysisQueryRunStatusSchema,
  CreateAnalysisQueryRunRequestSchema,
} from "./analysis-query-run.js";
import {
  DATASET_ARTIFACT_SCHEMA_VERSION,
  DatasetArtifactSchema,
} from "./dataset-artifact.js";
import { adminContracts, findAdminContract } from "../contracts.js";
import { ANALYTICS_ERROR_CODES } from "./errors.js";

const query = {
  filters: [],
  groupBy: [],
  measures: [],
  page: { size: 50 },
  schemaVersion: ANALYTICS_QUERY_VERSION,
  select: ["status"],
  sort: [],
  sourceKey: "support.tickets",
  sourceRevision: "support.tickets/v1",
};

const lineage = {
  generatedAt: "2026-07-27T00:00:02.000Z",
  policyDigest: "b".repeat(64),
  queryDigest: "a".repeat(64),
  sourceKey: "support.tickets",
  sourceRevision: "support.tickets/v1",
};

const resultSchema = [
  {
    key: "status",
    label: "Status",
    nullable: false,
    scalarType: "string" as const,
  },
];

const readyArtifact = {
  byteSize: 128,
  createdAt: "2026-07-27T00:00:01.000Z",
  downloadAvailable: true,
  expiresAt: "2026-07-28T00:00:01.000Z",
  failedAt: null,
  failureCode: null,
  id: "22222222-2222-4222-8222-222222222222",
  lineage,
  preview: [{ status: "open" }],
  queryRunId: "11111111-1111-4111-8111-111111111111",
  readyAt: "2026-07-27T00:00:03.000Z",
  resultSchema,
  rowCount: 1,
  schemaVersion: DATASET_ARTIFACT_SCHEMA_VERSION,
  sha256: "c".repeat(64),
  status: "ready" as const,
  updatedAt: "2026-07-27T00:00:03.000Z",
};

const queuedRun = {
  artifactId: null,
  createdAt: "2026-07-27T00:00:00.000Z",
  error: null,
  expiresAt: "2026-07-28T00:00:00.000Z",
  finishedAt: null,
  id: "11111111-1111-4111-8111-111111111111",
  normalizedQuery: query,
  policyDigest: null,
  policyRevision: "analytics-query-policy-v1",
  queryDigest: "a".repeat(64),
  queuedAt: "2026-07-27T00:00:00.000Z",
  resultKind: null,
  schemaVersion: ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
  sourceKey: "support.tickets",
  sourceRevision: "support.tickets/v1",
  startedAt: null,
  status: "queued" as const,
  updatedAt: "2026-07-27T00:00:00.000Z",
};

describe("analytics query-run contracts", () => {
  it("mirrors RuntimeRun statuses and accepts the strict submission body", () => {
    assert.deepEqual(AnalysisQueryRunStatusSchema.options, [
      "cancelled",
      "cancelling",
      "failed",
      "queued",
      "running",
      "succeeded",
      "timedOut",
      "waiting",
    ]);
    assert.equal(
      CreateAnalysisQueryRunRequestSchema.safeParse({
        idempotencyKey: "ticket-report:2026-07-27",
        query,
      }).success,
      true,
    );
    assert.equal(
      CreateAnalysisQueryRunRequestSchema.safeParse({
        idempotencyKey: " invalid ",
        query,
      }).success,
      false,
    );
    assert.equal(
      AnalysisQueryRunParamsSchema.safeParse({
        runId: "11111111-1111-4111-8111-111111111111",
      }).success,
      true,
    );
  });

  it("publishes a versioned status DTO without internal identity fields", () => {
    assert.equal(AnalysisQueryRunSchema.safeParse(queuedRun).success, true);
    for (const internalField of [
      "integrationTokenId",
      "principalType",
      "requestId",
      "requestedByAccountId",
      "workspaceId",
    ]) {
      assert.equal(
        AnalysisQueryRunSchema.safeParse({
          ...queuedRun,
          [internalField]: "internal",
        }).success,
        false,
      );
    }
  });

  it("requires terminal errors and result pointers to match status", () => {
    const succeeded = {
      ...queuedRun,
      finishedAt: "2026-07-27T00:00:03.000Z",
      policyDigest: "b".repeat(64),
      resultKind: "artifact" as const,
      artifactId: readyArtifact.id,
      startedAt: "2026-07-27T00:00:01.000Z",
      status: "succeeded" as const,
      updatedAt: "2026-07-27T00:00:03.000Z",
    };
    assert.equal(AnalysisQueryRunSchema.safeParse(succeeded).success, true);
    assert.equal(
      AnalysisQueryRunSchema.safeParse({ ...succeeded, artifactId: null }).success,
      false,
    );
    assert.equal(
      AnalysisQueryRunSchema.safeParse({
        ...queuedRun,
        error: {
          code: "ANALYTICS_ADAPTER_UNAVAILABLE",
          message: "Source unavailable",
        },
        finishedAt: "2026-07-27T00:00:03.000Z",
        status: "failed",
      }).success,
      true,
    );
  });
});

describe("dataset artifact contracts", () => {
  it("accepts complete ready artifacts and rejects storage coordinates", () => {
    assert.equal(DatasetArtifactSchema.safeParse(readyArtifact).success, true);
    assert.equal(
      DatasetArtifactSchema.safeParse({
        ...readyArtifact,
        objectKey: "workspace/secret.csv",
      }).success,
      false,
    );
    assert.equal(
      DatasetArtifactSchema.safeParse({
        ...readyArtifact,
        downloadAvailable: true,
        preview: null,
      }).success,
      false,
    );
  });

  it("redacts preview payloads and downloads after expiry", () => {
    const expired = {
      ...readyArtifact,
      downloadAvailable: false,
      preview: null,
      status: "expired" as const,
    };
    assert.equal(DatasetArtifactSchema.safeParse(expired).success, true);
    assert.equal(
      DatasetArtifactSchema.safeParse({
        ...expired,
        preview: [{ status: "open" }],
      }).success,
      false,
    );
  });

  it("returns either a validated inline result or an artifact", () => {
    const result = {
      lineage,
      pageInfo: { hasMore: false, nextCursor: null },
      rows: [{ status: "open" }],
      schema: resultSchema,
      schemaVersion: ANALYTICS_RESULT_VERSION,
      summary: { durationMs: 1, returnedRows: 1, truncated: false },
    };
    assert.equal(
      AnalysisQueryResultSchema.safeParse({ kind: "inline", result }).success,
      true,
    );
    assert.equal(
      AnalysisQueryResultSchema.safeParse({
        artifact: readyArtifact,
        kind: "artifact",
      }).success,
      true,
    );
  });

  it("publishes stable query-run and artifact errors", () => {
    for (const code of [
      "ANALYTICS_QUERY_RUN_NOT_FOUND",
      "ANALYTICS_QUERY_RUN_NOT_READY",
      "ANALYTICS_QUERY_RUN_INVALID",
      "ANALYTICS_QUERY_RUN_UNAVAILABLE",
      "ANALYTICS_QUERY_RUN_IDEMPOTENCY_CONFLICT",
      "ANALYTICS_ARTIFACT_NOT_FOUND",
      "ANALYTICS_ARTIFACT_NOT_READY",
      "ANALYTICS_ARTIFACT_INVALID",
      "ANALYTICS_ARTIFACT_UNAVAILABLE",
    ] as const) {
      assert.ok(ANALYTICS_ERROR_CODES.includes(code));
    }
  });
});

describe("analytics query-run API contracts", () => {
  it("registers the asynchronous lifecycle and protected artifact redirect", () => {
    assert.equal(adminContracts.analyticsQueryRunCreate.responses[202], AnalysisQueryRunSchema);
    assert.equal(adminContracts.analyticsQueryRunResult.responses[200], AnalysisQueryResultSchema);
    assert.equal(adminContracts.analyticsArtifactContent.binary, true);
    assert.equal(adminContracts.analyticsArtifactContent.responses[302], null);
    assert.equal(
      findAdminContract(
        "GET",
        "/api/admin/analytics/query-runs/4b80d5ad-5a63-4f5f-86e6-bd6927a04d9a/result",
      )?.contract.id,
      "analytics.queryRuns.result",
    );
  });
});
