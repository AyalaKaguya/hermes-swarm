import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HttpException } from "@nestjs/common";
import {
  ANALYTICS_QUERY_VERSION,
  ANALYTICS_RESULT_VERSION,
  AnalysisQuerySchema,
  type AnalysisQuery,
  type DatasetResult,
} from "@hermes-swarm/api-contracts/analytics";
import {
  ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
  DATASET_ARTIFACT_SCHEMA_VERSION,
  AnalysisQueryRun as AnalysisQueryRunEntity,
  DatasetArtifact as DatasetArtifactEntity,
  FileObject,
  RuntimeRun,
} from "@hermes-swarm/core";
import type { EntityManager } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import {
  RuntimeCancellationNotFoundError,
  RuntimeSubmissionConflictError,
} from "../../common/jobs/runtime-submission.types.js";
import type { ObjectStorage } from "../../infrastructure/files/object-storage.js";
import {
  ANALYSIS_QUERY_RUN_RETENTION_MS,
  AnalysisQueryRunService,
} from "./analysis-query-run.service.js";
import { analyticsDigest } from "./analytics-digest.js";
import type { AnalyticsAuthorizationContext } from "./analytics-source.adapter.js";

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "33333333-3333-4333-8333-333333333333";
const RUN_ID = "44444444-4444-4444-8444-444444444444";
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555";
const FILE_ID = "66666666-6666-4666-8666-666666666666";
const NOW = new Date("2026-07-27T08:00:00.000Z");
const FUTURE = new Date("2099-07-28T08:00:00.000Z");

const QUERY = {
  schemaVersion: ANALYTICS_QUERY_VERSION,
  select: ["status"],
  sourceKey: "support.tickets",
  sourceRevision: "support.tickets/v1",
} as const;

const AUTHORIZATION: AnalyticsAuthorizationContext = {
  actorId: ACTOR_ID,
  integrationTokenId: null,
  locale: "en",
  permissions: new Set(["analytics.ticket_dataset.query:workspace"]),
  principalType: "workspace",
  requestId: "request-1",
  timeZone: "UTC",
};

describe("AnalysisQueryRunService", () => {
  it("atomically submits a normalized run using trusted Workspace context", async () => {
    const state = createState();
    const result = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );

    assert.equal(result.id, RUN_ID);
    assert.equal(result.status, "queued");
    assert.equal(result.policyDigest, null);
    assert.equal(result.policyRevision, "support.tickets-policy:v1");
    assert.equal(result.sourceKey, "support.tickets");
    assert.equal(result.sourceRevision, "support.tickets/v1");
    assert.equal(result.normalizedQuery.page.size, 50);
    assert.equal(state.runs.length, 1);
    assert.equal(state.runs[0]?.workspaceId, WORKSPACE_A);
    assert.equal(state.runs[0]?.requestedByAccountId, ACTOR_ID);
    assert.equal(state.runs[0]?.integrationTokenId, null);
    assert.equal(state.runs[0]?.inlineResult, null);
    assert.equal(state.runs[0]?.createdAt.getTime(), NOW.getTime());
    assert.equal(state.runs[0]?.updatedAt.getTime(), NOW.getTime());
    assert.equal(
      state.runs[0]?.expiresAt.getTime(),
      NOW.getTime() + ANALYSIS_QUERY_RUN_RETENTION_MS,
    );
    assert.deepEqual(state.transactionIsolations, ["READ COMMITTED"]);
    assert.equal(state.submissions.length, 1);
    assert.equal(state.submissions[0]?.runKind, "analytics.query");
    assert.equal(state.submissions[0]?.deadlineAt?.getTime(), NOW.getTime() + 10_000);
    assert.equal("workspaceId" in (state.submissions[0] ?? {}), false);
  });

  it("rejects unknown body keys and maps idempotency conflicts to stable 409", async () => {
    const state = createState();
    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () =>
        state.service.submit(
          {
            idempotencyKey: "query-run-1",
            query: QUERY,
            workspaceId: WORKSPACE_B,
          },
          AUTHORIZATION,
        )
      ),
      400,
      "ANALYTICS_QUERY_RUN_INVALID",
    );
    assert.equal(state.submissions.length, 0);

    state.submitError = new RuntimeSubmissionConflictError();
    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () =>
        state.service.submit(
          { idempotencyKey: "query-run-1", query: QUERY },
          AUTHORIZATION,
        )
      ),
      409,
      "ANALYTICS_QUERY_RUN_IDEMPOTENCY_CONFLICT",
    );
  });

  it("returns an existing matching domain row for a deduplicated runtime submission", async () => {
    const state = createState();
    const first = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    const repeated = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );

    assert.deepEqual(repeated, first);
    assert.equal(state.runs.length, 1);
    assert.equal(state.runtimeRuns.length, 1);
  });

  it("reconciles terminal RuntimeRuns during deduplicated submissions", async () => {
    const cases = [
      {
        expectedCode: null,
        lastErrorCode: "PRIVATE_CANCEL_CODE",
        status: "cancelled" as const,
      },
      {
        expectedCode: "ANALYTICS_QUERY_RUN_UNAVAILABLE",
        lastErrorCode: "PRIVATE_RUNTIME_FAILURE",
        status: "failed" as const,
      },
      {
        expectedCode: "ANALYTICS_QUERY_TIMEOUT",
        lastErrorCode: "PRIVATE_TIMEOUT_CODE",
        status: "timedOut" as const,
      },
    ];

    for (const testCase of cases) {
      const state = createState();
      await state.inWorkspace(WORKSPACE_A, () =>
        state.service.submit(
          { idempotencyKey: "query-run-1", query: QUERY },
          AUTHORIZATION,
        )
      );
      const finishedAt = new Date("2026-07-27T08:00:02.000Z");
      Object.assign(state.runtimeRuns[0]!, {
        finishedAt,
        lastErrorCode: testCase.lastErrorCode,
        status: testCase.status,
      });
      state.databaseNow = new Date("2026-07-27T08:00:03.000Z");

      const repeated = await state.inWorkspace(WORKSPACE_A, () =>
        state.service.submit(
          { idempotencyKey: "query-run-1", query: QUERY },
          AUTHORIZATION,
        )
      );

      assert.equal(repeated.status, testCase.status);
      assert.equal(repeated.finishedAt, finishedAt.toISOString());
      assert.equal(repeated.error?.code ?? null, testCase.expectedCode);
      assert.equal(state.runs[0]!.failureCode, testCase.expectedCode);
      assert.deepEqual(state.lockOrder, ["runtime", "analysis"]);
      assert.equal(state.runs.length, 1);
      assert.equal(state.runtimeRuns.length, 1);
    }
  });

  it("returns completed artifact metadata for a deduplicated submission", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    Object.assign(state.runs[0]!, {
      policyDigest: "b".repeat(64),
      status: "succeeded",
      succeededAt: new Date("2026-07-27T08:00:01.000Z"),
    });
    const file = fileObject();
    state.files.push(file);
    state.artifacts.push(artifactEntity(file));

    const repeated = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );

    assert.equal(repeated.resultKind, "artifact");
    assert.equal(repeated.artifactId, ARTIFACT_ID);
    assert.equal(state.runs.length, 1);
    assert.equal(state.runtimeRuns.length, 1);
  });

  it("fails closed when a deduplicated runtime row has mismatched domain lineage", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    state.runs[0]!.sourceRevision = "support.tickets/private";

    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () =>
        state.service.submit(
          { idempotencyKey: "query-run-1", query: QUERY },
          AUTHORIZATION,
        )
      ),
      500,
      "ANALYTICS_QUERY_RUN_INVALID",
    );
  });

  it("makes unknown, cross-Workspace and expired run ids indistinguishable", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );

    for (const [workspaceId, runId] of [
      [WORKSPACE_A, "77777777-7777-4777-8777-777777777777"],
      [WORKSPACE_B, RUN_ID],
    ] as const) {
      await rejectsWith(
        state.inWorkspace(workspaceId, () => state.service.get(runId)),
        404,
        "ANALYTICS_QUERY_RUN_NOT_FOUND",
      );
    }

    state.runs[0]!.expiresAt = new Date("2020-01-01T00:00:00.000Z");
    Object.assign(state.runtimeRuns[0]!, {
      finishedAt: new Date("2026-07-27T08:00:01.000Z"),
      lastErrorCode: "PRIVATE_TIMEOUT_CODE",
      status: "timedOut",
    });
    state.databaseNow = new Date("2026-07-27T08:00:02.000Z");
    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () => state.service.get(RUN_ID)),
      404,
      "ANALYTICS_QUERY_RUN_NOT_FOUND",
    );
    assert.equal(state.runs[0]!.status, "queued");
    assert.equal(state.runs[0]!.timedOutAt, null);
  });

  it("reconciles an active run from a timed-out RuntimeRun in lock order", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    const startedAt = new Date("2026-07-27T08:00:01.000Z");
    const finishedAt = new Date("2026-07-27T08:00:03.000Z");
    const databaseNow = new Date("2026-07-27T08:00:04.000Z");
    Object.assign(state.runs[0]!, {
      cancelledAt: new Date("2026-07-27T08:00:02.000Z"),
      cancellingAt: new Date("2026-07-27T08:00:02.000Z"),
      failedAt: new Date("2026-07-27T08:00:02.000Z"),
      failureCode: "PRIVATE_STALE_FAILURE",
      inlineResult: datasetResult(),
      policyDigest: "b".repeat(64),
      startedAt: new Date(NOW),
      status: "waiting",
      succeededAt: new Date("2026-07-27T08:00:02.000Z"),
      timedOutAt: new Date("2026-07-27T08:00:02.000Z"),
      waitingAt: new Date("2026-07-27T08:00:02.000Z"),
    });
    Object.assign(state.runtimeRuns[0]!, {
      finishedAt,
      lastErrorCode: "PRIVATE_TIMEOUT_CODE",
      startedAt,
      status: "timedOut",
    });
    state.databaseNow = databaseNow;

    const reconciled = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.get(RUN_ID)
    );

    assert.equal(reconciled.status, "timedOut");
    assert.equal(reconciled.startedAt, startedAt.toISOString());
    assert.equal(reconciled.finishedAt, finishedAt.toISOString());
    assert.equal(reconciled.updatedAt, databaseNow.toISOString());
    assert.deepEqual(reconciled.error, {
      code: "ANALYTICS_QUERY_TIMEOUT",
      message: "Analytics query exceeded its execution deadline.",
    });
    assert.deepEqual(state.lockOrder, ["runtime", "analysis"]);
    assert.deepEqual(state.runtimeRunLocks, [
      { mode: "pessimistic_write" },
    ]);
    assert.deepEqual(state.runLocks, [{ mode: "pessimistic_write" }]);
    assert.equal(state.runs[0]!.waitingAt, null);
    assert.equal(state.runs[0]!.cancellingAt, null);
    assert.equal(state.runs[0]!.cancelledAt, null);
    assert.equal(state.runs[0]!.failedAt, null);
    assert.equal(state.runs[0]!.succeededAt, null);
    assert.equal(state.runs[0]!.timedOutAt?.getTime(), finishedAt.getTime());
    assert.equal(state.runs[0]!.failureCode, "ANALYTICS_QUERY_TIMEOUT");
    assert.equal(state.runs[0]!.inlineResult, null);
    assert.equal(state.runs[0]!.policyDigest, null);
  });

  it("reconciles RuntimeRun failure before returning stable not-ready results", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    const finishedAt = new Date("2026-07-27T08:00:02.000Z");
    Object.assign(state.runtimeRuns[0]!, {
      finishedAt,
      lastErrorCode: "PRIVATE_RUNTIME_FAILURE",
      startedAt: new Date("2026-07-27T08:00:01.000Z"),
      status: "failed",
    });
    state.databaseNow = new Date("2026-07-27T08:00:03.000Z");

    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () => state.service.getResult(RUN_ID)),
      409,
      "ANALYTICS_QUERY_RUN_NOT_READY",
    );
    assert.equal(state.runs[0]!.status, "failed");
    assert.equal(state.runs[0]!.failedAt?.getTime(), finishedAt.getTime());
    assert.equal(
      state.runs[0]!.failureCode,
      "ANALYTICS_QUERY_RUN_UNAVAILABLE",
    );
    assert.deepEqual(state.lockOrder, ["runtime", "analysis"]);

    const failed = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.get(RUN_ID)
    );
    assert.deepEqual(failed.error, {
      code: "ANALYTICS_QUERY_RUN_UNAVAILABLE",
      message: "Analytics query execution failed.",
    });
    assert.equal(JSON.stringify(failed).includes("PRIVATE_RUNTIME_FAILURE"), false);
    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () => state.service.getResult(RUN_ID)),
      409,
      "ANALYTICS_QUERY_RUN_NOT_READY",
    );
  });

  it("fails closed when RuntimeRun succeeded before the active domain row", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    Object.assign(state.runtimeRuns[0]!, {
      finishedAt: new Date("2026-07-27T08:00:02.000Z"),
      startedAt: new Date("2026-07-27T08:00:01.000Z"),
      status: "succeeded",
    });
    state.databaseNow = new Date("2026-07-27T08:00:03.000Z");

    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () => state.service.get(RUN_ID)),
      500,
      "ANALYTICS_QUERY_RUN_INVALID",
    );
    assert.equal(state.runs[0]!.status, "queued");
    assert.equal(state.runs[0]!.succeededAt, null);
    assert.deepEqual(state.lockOrder, ["runtime", "analysis"]);
  });

  it("fails closed when RuntimeRun success conflicts with domain failure", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    Object.assign(state.runs[0]!, {
      failedAt: new Date("2026-07-27T08:00:01.000Z"),
      failureCode: "ANALYTICS_QUERY_RUN_UNAVAILABLE",
      status: "failed",
    });
    Object.assign(state.runtimeRuns[0]!, {
      finishedAt: new Date("2026-07-27T08:00:02.000Z"),
      startedAt: new Date(NOW),
      status: "succeeded",
    });
    state.databaseNow = new Date("2026-07-27T08:00:03.000Z");

    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () => state.service.get(RUN_ID)),
      500,
      "ANALYTICS_QUERY_RUN_INVALID",
    );
    assert.equal(state.runs[0]!.status, "failed");
    assert.equal(
      state.runs[0]!.failedAt?.toISOString(),
      "2026-07-27T08:00:01.000Z",
    );
    assert.deepEqual(state.lockOrder, ["runtime", "analysis"]);
  });

  it("returns 409 before completion and a discriminated inline result after success", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () => state.service.getResult(RUN_ID)),
      409,
      "ANALYTICS_QUERY_RUN_NOT_READY",
    );

    const result = datasetResult();
    Object.assign(state.runs[0]!, {
      inlineResult: result,
      policyDigest: "b".repeat(64),
      status: "succeeded",
      succeededAt: new Date("2026-07-27T08:00:01.000Z"),
    });
    assert.deepEqual(
      await state.inWorkspace(WORKSPACE_A, () =>
        state.service.getResult(RUN_ID)
      ),
      { kind: "inline", result },
    );
  });

  it("returns artifact metadata and signs content without exposing its object key", async () => {
    const state = createState();
    const run = queryRunEntity({
      inlineResult: null,
      policyDigest: "b".repeat(64),
      status: "succeeded",
      succeededAt: new Date("2026-07-27T08:00:01.000Z"),
    });
    const file = fileObject();
    const artifact = artifactEntity(file);
    state.runs.push(run);
    state.runtimeRuns.push(
      runtimeRunEntity(run, {
        finishedAt: run.succeededAt,
        status: "succeeded",
      }),
    );
    state.artifacts.push(artifact);
    state.files.push(file);

    const result = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.getResult(RUN_ID)
    );
    assert.equal(result.kind, "artifact");
    if (result.kind === "artifact") {
      assert.equal(result.artifact.id, ARTIFACT_ID);
      assert.equal(
        result.artifact.schemaVersion,
        DATASET_ARTIFACT_SCHEMA_VERSION,
      );
      assert.equal("fileObjectId" in result.artifact, false);
      assert.equal("objectKey" in result.artifact, false);
    }

    const url = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.getArtifactContentUrl(ARTIFACT_ID)
    );
    assert.equal(url, "https://storage.invalid/signed-download");
    assert.deepEqual(state.downloads, [
      {
        expiresInSeconds: 30,
        key: "private/analytics/result.json",
        originalName: "analytics-result.json",
      },
    ]);
    assert.equal(url.includes("private/analytics"), false);

    artifact.schemaVersion = "private-artifact/v0" as never;
    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () =>
        state.service.getArtifactContentUrl(ARTIFACT_ID)
      ),
      500,
      "ANALYTICS_ARTIFACT_INVALID",
    );
    assert.equal(state.downloads.length, 1);

    await rejectsWith(
      state.inWorkspace(WORKSPACE_B, () =>
        state.service.getArtifactContentUrl(ARTIFACT_ID)
      ),
      404,
      "ANALYTICS_ARTIFACT_NOT_FOUND",
    );
  });

  it("invalidates a ready artifact when RuntimeRun overrides domain success", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    const result = datasetResult();
    const file = fileObject();
    const artifact = artifactEntity(file);
    state.files.push(file);
    state.artifacts.push(artifact);
    Object.assign(state.runs[0]!, {
      inlineResult: null,
      policyDigest: result.lineage.policyDigest,
      status: "succeeded",
      succeededAt: new Date(result.lineage.generatedAt),
    });
    Object.assign(state.runtimeRuns[0]!, {
      finishedAt: new Date("2026-07-27T08:00:02.000Z"),
      lastErrorCode: "PRIVATE_TIMEOUT_CODE",
      startedAt: new Date(NOW),
      status: "timedOut",
    });
    state.databaseNow = new Date("2026-07-27T08:00:03.000Z");

    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () =>
        state.service.getArtifactContentUrl(ARTIFACT_ID)
      ),
      409,
      "ANALYTICS_ARTIFACT_NOT_READY",
    );

    assert.equal(state.runs[0]!.status, "timedOut");
    assert.equal(state.runs[0]!.succeededAt, null);
    assert.equal(
      state.runs[0]!.timedOutAt?.toISOString(),
      "2026-07-27T08:00:02.000Z",
    );
    assert.equal(artifact.status, "expired");
    assert.equal(artifact.fileObjectId, null);
    assert.equal(artifact.preview, null);
    assert.equal(file.status, "ready");
    assert.deepEqual(state.downloads, []);
    assert.deepEqual(state.lockOrder, ["runtime", "analysis", "artifact"]);
    assert.deepEqual(state.artifactLocks, [
      { mode: "pessimistic_write" },
    ]);

    const run = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.get(RUN_ID)
    );
    assert.equal(run.status, "timedOut");
    assert.equal(run.resultKind, null);
    assert.equal(run.artifactId, null);
  });

  it("cancels only an AnalysisQueryRun in the trusted Workspace transaction", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    const cancelled = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.cancel(RUN_ID)
    );

    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.finishedAt, "2026-07-27T08:00:02.000Z");
    assert.equal(state.runs[0]?.cancelledAt?.toISOString(), cancelled.finishedAt);
    assert.deepEqual(state.runLocks, [{ mode: "pessimistic_write" }]);

    await rejectsWith(
      state.inWorkspace(WORKSPACE_B, () => state.service.cancel(RUN_ID)),
      404,
      "ANALYTICS_QUERY_RUN_NOT_FOUND",
    );
  });

  it("treats cancellation as idempotent for every terminal QueryRun", async () => {
    const terminalRuns: Array<Partial<AnalysisQueryRunEntity>> = [
      {
        cancelledAt: new Date("2026-07-27T08:00:01.000Z"),
        status: "cancelled",
      },
      {
        failedAt: new Date("2026-07-27T08:00:01.000Z"),
        failureCode: "ANALYTICS_ADAPTER_UNAVAILABLE",
        status: "failed",
      },
      {
        failureCode: "ANALYTICS_QUERY_TIMEOUT",
        status: "timedOut",
        timedOutAt: new Date("2026-07-27T08:00:01.000Z"),
      },
      {
        inlineResult: datasetResult(),
        policyDigest: "b".repeat(64),
        status: "succeeded",
        succeededAt: new Date("2026-07-27T08:00:01.000Z"),
      },
    ];

    for (const terminal of terminalRuns) {
      const state = createState();
      const run = queryRunEntity(terminal);
      state.runs.push(run);
      state.runtimeRuns.push(runtimeRunEntity(run));
      const before = await state.inWorkspace(WORKSPACE_A, () =>
        state.service.get(RUN_ID)
      );
      const lockCountBeforeCancel = state.runLocks.length;

      const cancelled = await state.inWorkspace(WORKSPACE_A, () =>
        state.service.cancel(RUN_ID)
      );

      assert.deepEqual(cancelled, before);
      assert.deepEqual(state.cancellationRequests, []);
      assert.equal(state.runLocks.length, lockCountBeforeCancel + 1);
    }
  });

  it("projects a conflicting RuntimeRun terminal state over an inline result", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    const result = datasetResult();
    Object.assign(state.runs[0]!, {
      inlineResult: result,
      policyDigest: result.lineage.policyDigest,
      status: "succeeded",
      succeededAt: new Date(result.lineage.generatedAt),
    });
    Object.assign(state.runtimeRuns[0]!, {
      finishedAt: new Date("2026-07-27T08:00:02.000Z"),
      lastErrorCode: "PRIVATE_RUNTIME_FAILURE",
      status: "failed",
    });
    state.databaseNow = new Date("2026-07-27T08:00:03.000Z");

    const run = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.get(RUN_ID)
    );
    await rejectsWith(
      state.inWorkspace(WORKSPACE_A, () => state.service.getResult(RUN_ID)),
      409,
      "ANALYTICS_QUERY_RUN_NOT_READY",
    );

    assert.equal(run.status, "failed");
    assert.equal(run.resultKind, null);
    assert.equal(run.finishedAt, "2026-07-27T08:00:02.000Z");
    assert.deepEqual(run.error, {
      code: "ANALYTICS_QUERY_RUN_UNAVAILABLE",
      message: "Analytics query execution failed.",
    });
    assert.equal(state.runs[0]!.inlineResult, null);
    assert.equal(state.runs[0]!.policyDigest, null);
    assert.equal(state.runs[0]!.failedAt?.toISOString(), run.finishedAt);
    assert.equal(state.runs[0]!.succeededAt, null);
    assert.deepEqual(state.lockOrder, [
      "runtime",
      "analysis",
      "runtime",
      "analysis",
    ]);
  });

  it("preserves a committed artifact while RuntimeRun finalization lags", async () => {
    const state = createState();
    await state.inWorkspace(WORKSPACE_A, () =>
      state.service.submit(
        { idempotencyKey: "query-run-1", query: QUERY },
        AUTHORIZATION,
      )
    );
    const result = datasetResult();
    const file = fileObject();
    state.files.push(file);
    state.artifacts.push(artifactEntity(file));
    Object.assign(state.runs[0]!, {
      inlineResult: null,
      policyDigest: result.lineage.policyDigest,
      status: "succeeded",
      succeededAt: new Date(result.lineage.generatedAt),
    });
    Object.assign(state.runtimeRuns[0]!, {
      startedAt: new Date(NOW),
      status: "running",
    });
    const before = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.getResult(RUN_ID)
    );

    const cancelled = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.cancel(RUN_ID)
    );
    const after = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.getResult(RUN_ID)
    );

    assert.equal(cancelled.status, "succeeded");
    assert.equal(cancelled.resultKind, "artifact");
    assert.equal(cancelled.artifactId, ARTIFACT_ID);
    assert.deepEqual(after, before);
    assert.equal(state.runtimeRuns[0]?.status, "running");
    assert.equal(state.runtimeRuns[0]?.cancellationRequestedAt, null);
    assert.deepEqual(state.cancellationRequests, []);
  });

  it("rolls back racing RuntimeRun cancellation after result completion", async () => {
    for (const resultKind of ["inline", "artifact"] as const) {
      const state = createState();
      await state.inWorkspace(WORKSPACE_A, () =>
        state.service.submit(
          { idempotencyKey: "query-run-1", query: QUERY },
          AUTHORIZATION,
        )
      );
      Object.assign(state.runs[0]!, {
        startedAt: new Date(NOW),
        status: "running",
      });
      Object.assign(state.runtimeRuns[0]!, {
        startedAt: new Date(NOW),
        status: "running",
      });
      const result = datasetResult();
      state.beforeCancellation = () => {
        Object.assign(state.runs[0]!, {
          inlineResult: resultKind === "inline" ? result : null,
          policyDigest: result.lineage.policyDigest,
          status: "succeeded",
          succeededAt: new Date(result.lineage.generatedAt),
        });
        if (resultKind === "artifact") {
          const file = fileObject();
          state.files.push(file);
          state.artifacts.push(artifactEntity(file));
        }
      };

      const cancelled = await state.inWorkspace(WORKSPACE_A, () =>
        state.service.cancel(RUN_ID)
      );
      const committed = await state.inWorkspace(WORKSPACE_A, () =>
        state.service.getResult(RUN_ID)
      );

      assert.equal(cancelled.status, "succeeded");
      assert.equal(cancelled.resultKind, resultKind);
      assert.equal(
        cancelled.artifactId,
        resultKind === "artifact" ? ARTIFACT_ID : null,
      );
      assert.equal(committed.kind, resultKind);
      assert.equal(state.runtimeRuns[0]?.status, "running");
      assert.equal(state.runtimeRuns[0]?.cancellationRequestedAt, null);
      assert.deepEqual(state.cancellationRequests, [RUN_ID]);
    }
  });

  it("does not expose pending artifacts or private runtime failure codes", async () => {
    const state = createState();
    const file = fileObject();
    state.artifacts.push(
      Object.assign(artifactEntity(file), {
        byteSize: null,
        fileObjectId: null,
        lineage: null,
        preview: null,
        readyAt: null,
        resultSchema: null,
        rowCount: null,
        sha256: null,
        status: "pending",
      }),
    );
    const run = queryRunEntity();
    state.runs.push(run);
    state.runtimeRuns.push(runtimeRunEntity(run));

    const queued = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.get(RUN_ID)
    );
    assert.equal(queued.resultKind, null);
    assert.equal(queued.artifactId, null);

    Object.assign(state.runs[0]!, {
      failedAt: new Date("2026-07-27T08:00:01.000Z"),
      failureCode: "PRIVATE_RUNTIME_FAILURE",
      status: "failed",
    });
    const failed = await state.inWorkspace(WORKSPACE_A, () =>
      state.service.get(RUN_ID)
    );
    assert.deepEqual(failed.error, {
      code: "ANALYTICS_QUERY_RUN_UNAVAILABLE",
      message: "Analytics query execution failed.",
    });
    assert.equal(JSON.stringify(failed).includes("PRIVATE_RUNTIME_FAILURE"), false);
  });
});

function createState() {
  const context = new WorkspaceContextService();
  const runs: AnalysisQueryRunEntity[] = [];
  const artifacts: DatasetArtifactEntity[] = [];
  const files: FileObject[] = [];
  const runtimeRuns: RuntimeRun[] = [];
  const idempotency = new Map<string, RuntimeRun>();
  const submissions: Array<Record<string, any>> = [];
  const transactionIsolations: string[] = [];
  const runLocks: unknown[] = [];
  const runtimeRunLocks: unknown[] = [];
  const artifactLocks: unknown[] = [];
  const lockOrder: Array<"analysis" | "artifact" | "runtime"> = [];
  const downloads: unknown[] = [];
  const cancellationRequests: string[] = [];
  let beforeCancellation: (() => void) | null = null;
  let databaseNow = new Date(NOW);
  let rollbackRuntimeCancellation: (() => void) | null = null;
  let submitError: unknown;

  const runRepository = {
    create(value: Partial<AnalysisQueryRunEntity>) {
      return Object.assign(new AnalysisQueryRunEntity(), value);
    },
    async findOne({ lock, where }: { lock?: unknown; where: Partial<AnalysisQueryRunEntity> }) {
      if (lock) {
        runLocks.push(lock);
        lockOrder.push("analysis");
      }
      return runs.find((item) => matches(item, where)) ?? null;
    },
    async save(value: AnalysisQueryRunEntity) {
      value.schemaVersion ??= ANALYSIS_QUERY_RUN_SCHEMA_VERSION;
      value.createdAt ??= new Date(NOW);
      value.updatedAt = new Date(databaseNow);
      const index = runs.findIndex(
        (item) => item.id === value.id && item.workspaceId === value.workspaceId,
      );
      if (index === -1) runs.push(value);
      else runs[index] = value;
      return value;
    },
  };
  const artifactRepository = {
    async findOne({ lock, relations, where }: {
      lock?: unknown;
      relations?: unknown;
      where: Partial<DatasetArtifactEntity>;
    }) {
      if (lock) {
        artifactLocks.push(lock);
        lockOrder.push("artifact");
      }
      const artifact = artifacts.find((item) => matches(item, where)) ?? null;
      if (artifact && relations) {
        artifact.fileObject =
          files.find((file) => file.id === artifact.fileObjectId) ?? null;
      }
      return artifact;
    },
    async save(value: DatasetArtifactEntity) {
      value.updatedAt = new Date(databaseNow);
      const index = artifacts.findIndex(
        (item) => item.id === value.id && item.workspaceId === value.workspaceId,
      );
      if (index === -1) artifacts.push(value);
      else artifacts[index] = value;
      return value;
    },
  };
  const runtimeRunRepository = {
    async findOne({ lock, where }: { lock?: unknown; where: Partial<RuntimeRun> }) {
      if (lock) {
        runtimeRunLocks.push(lock);
        lockOrder.push("runtime");
      }
      return runtimeRuns.find((item) => matches(item, where)) ?? null;
    },
  };
  const repository = (entity: unknown) => {
    if (entity === AnalysisQueryRunEntity) return runRepository;
    if (entity === DatasetArtifactEntity) return artifactRepository;
    if (entity === RuntimeRun) return runtimeRunRepository;
    throw new Error("Unexpected repository");
  };
  const manager = {
    getRepository: repository,
    async query(sql: string) {
      if (sql.includes("clock_timestamp()")) {
        return [{ databaseNow: new Date(databaseNow) }];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as EntityManager;
  const dataSource = {
    getRepository: repository,
    async transaction<T>(
      isolation: string,
      work: (manager: EntityManager) => Promise<T>,
    ) {
      transactionIsolations.push(isolation);
      try {
        return await work(manager);
      } catch (error) {
        rollbackRuntimeCancellation?.();
        throw error;
      } finally {
        rollbackRuntimeCancellation = null;
      }
    },
  };
  const runtimeSubmission = {
    async submitInTransaction(_manager: EntityManager, input: Record<string, any>) {
      submissions.push(input);
      if (submitError) throw submitError;
      const workspaceId = context.current()!.workspaceId;
      const key = `${workspaceId}:${input.idempotencyKey}`;
      const existing = idempotency.get(key);
      if (existing) {
        if (existing.requestDigest !== input.requestDigest) {
          throw new RuntimeSubmissionConflictError();
        }
        return { deduplicated: true, outbox: {}, run: existing };
      }
      const run = Object.assign(new RuntimeRun(), {
        cancellationRequestedAt: null,
        finishedAt: null,
        heartbeatAt: null,
        id: RUN_ID,
        lastErrorCode: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        leaseToken: null,
        requestDigest: input.requestDigest,
        runKind: input.runKind,
        startedAt: null,
        status: "queued",
        workspaceId,
      });
      runtimeRuns.push(run);
      idempotency.set(key, run);
      return { deduplicated: false, outbox: {}, run };
    },
    async requestCancellationInTransaction(
      _manager: EntityManager,
      runId: string,
    ) {
      cancellationRequests.push(runId);
      const workspaceId = context.current()!.workspaceId;
      const run = runtimeRuns.find(
        (candidate) => candidate.id === runId && candidate.workspaceId === workspaceId,
      );
      if (!run) throw new RuntimeCancellationNotFoundError();
      const previous = {
        cancellationRequestedAt: run.cancellationRequestedAt,
        finishedAt: run.finishedAt,
        status: run.status,
      };
      rollbackRuntimeCancellation = () => Object.assign(run, previous);
      const completeWhileWaiting = beforeCancellation;
      beforeCancellation = null;
      completeWhileWaiting?.();
      run.cancellationRequestedAt = new Date("2026-07-27T08:00:02.000Z");
      if (run.status === "running") {
        run.finishedAt = null;
        run.status = "cancelling";
      } else {
        run.finishedAt = new Date("2026-07-27T08:00:02.000Z");
        run.status = "cancelled";
      }
      return run;
    },
  };
  const gateway = {
    async validate(query: unknown) {
      return {
        query: AnalysisQuerySchema.parse(query),
        resultSchema: [],
        schema: {},
      };
    },
  };
  const sourceRegistry = {
    resolve(sourceKey: string) {
      return sourceKey === "support.tickets"
        ? { policyRevision: "support.tickets-policy:v1" }
        : null;
    },
  };
  const objectStorage = {
    bucket: "analytics-private",
    enabled: true,
    async presignDownload(input: unknown) {
      downloads.push(input);
      return "https://storage.invalid/signed-download";
    },
  } as ObjectStorage;
  const configService = {
    get(key: string, fallback: unknown) {
      return key === "storage.downloadUrlTtlSeconds" ? 30 : fallback;
    },
  };

  const state = {
    artifactLocks,
    artifacts,
    cancellationRequests,
    context,
    downloads,
    files,
    lockOrder,
    runLocks,
    runs,
    runtimeRunLocks,
    runtimeRuns,
    service: new AnalysisQueryRunService(
      dataSource as never,
      context,
      runtimeSubmission as never,
      gateway as never,
      sourceRegistry as never,
      objectStorage,
      configService as never,
    ),
    submissions,
    transactionIsolations,
    get databaseNow() {
      return new Date(databaseNow);
    },
    set databaseNow(value: Date) {
      databaseNow = new Date(value);
    },
    set beforeCancellation(value: (() => void) | null) {
      beforeCancellation = value;
    },
    get submitError() {
      return submitError;
    },
    set submitError(value: unknown) {
      submitError = value;
    },
    inWorkspace<T>(workspaceId: string, work: () => T) {
      return context.run({ scopeLevel: "workspace", workspaceId }, work);
    },
  };
  return state;
}

function queryRunEntity(
  overrides: Partial<AnalysisQueryRunEntity> = {},
): AnalysisQueryRunEntity {
  const normalizedQuery = AnalysisQuerySchema.parse(QUERY);
  return Object.assign(new AnalysisQueryRunEntity(), {
    cancelledAt: null,
    cancellingAt: null,
    createdAt: new Date(NOW),
    expiresAt: new Date(FUTURE),
    failedAt: null,
    failureCode: null,
    id: RUN_ID,
    inlineResult: null,
    integrationTokenId: null,
    normalizedQuery,
    policyDigest: null,
    policyRevision: "support.tickets-policy:v1",
    principalType: "workspace",
    queryDigest: analyticsDigest(normalizedQuery),
    queuedAt: new Date(NOW),
    requestId: "request-1",
    requestedByAccountId: ACTOR_ID,
    schemaVersion: ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
    sourceKey: "support.tickets",
    sourceRevision: "support.tickets/v1",
    startedAt: null,
    status: "queued",
    succeededAt: null,
    timedOutAt: null,
    updatedAt: new Date(NOW),
    waitingAt: null,
    workspaceId: WORKSPACE_A,
    ...overrides,
  });
}

function runtimeRunEntity(
  queryRun: AnalysisQueryRunEntity,
  overrides: Partial<RuntimeRun> = {},
): RuntimeRun {
  return Object.assign(new RuntimeRun(), {
    cancellationRequestedAt: null,
    finishedAt: null,
    heartbeatAt: null,
    id: queryRun.id,
    lastErrorCode: null,
    leaseExpiresAt: null,
    leaseOwner: null,
    leaseToken: null,
    requestDigest: analyticsDigest({
      actorId: queryRun.requestedByAccountId,
      integrationTokenId: queryRun.integrationTokenId,
      policyRevision: queryRun.policyRevision,
      principalType: queryRun.principalType,
      queryDigest: queryRun.queryDigest,
    }),
    runKind: "analytics.query",
    startedAt: null,
    status: "queued",
    workspaceId: queryRun.workspaceId,
    ...overrides,
  });
}

function artifactEntity(file: FileObject): DatasetArtifactEntity {
  const result = datasetResult();
  return Object.assign(new DatasetArtifactEntity(), {
    byteSize: file.byteSize,
    createdAt: new Date(NOW),
    expiresAt: new Date(FUTURE),
    failedAt: null,
    failureCode: null,
    fileObject: file,
    fileObjectId: file.id,
    id: ARTIFACT_ID,
    lineage: result.lineage,
    preview: result.rows,
    queryRunId: RUN_ID,
    readyAt: new Date("2026-07-27T08:00:01.000Z"),
    resultSchema: result.schema,
    rowCount: result.rows.length,
    schemaVersion: DATASET_ARTIFACT_SCHEMA_VERSION,
    sha256: file.sha256,
    status: "ready",
    updatedAt: new Date(NOW),
    workspaceId: WORKSPACE_A,
  });
}

function fileObject(): FileObject {
  return Object.assign(new FileObject(), {
    bucket: "analytics-private",
    byteSize: 512,
    id: FILE_ID,
    objectKey: "private/analytics/result.json",
    originalName: "analytics-result.json",
    purpose: "artifact",
    scopeType: "workspace",
    sha256: "c".repeat(64),
    status: "ready",
    workspaceId: WORKSPACE_A,
  });
}

function datasetResult(): DatasetResult {
  return {
    lineage: {
      generatedAt: "2026-07-27T08:00:01.000Z",
      policyDigest: "b".repeat(64),
      queryDigest: "a".repeat(64),
      sourceKey: "support.tickets",
      sourceRevision: "support.tickets/v1",
    },
    pageInfo: { hasMore: false, nextCursor: null },
    rows: [{ status: "open" }],
    schema: [
      {
        key: "status",
        label: "Status",
        nullable: false,
        scalarType: "string",
      },
    ],
    schemaVersion: ANALYTICS_RESULT_VERSION,
    summary: { durationMs: 1, returnedRows: 1, truncated: false },
  };
}

function matches(value: object, where: object) {
  const record = value as Record<string, unknown>;
  return Object.entries(where).every(([key, expected]) => record[key] === expected);
}

async function rejectsWith(
  promise: Promise<unknown>,
  status: number,
  code: string,
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof HttpException);
    assert.equal(error.getStatus(), status);
    assert.equal(
      (error.getResponse() as { code?: unknown }).code,
      code,
    );
    return true;
  });
}
