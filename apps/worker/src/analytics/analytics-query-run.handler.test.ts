import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_QUERY_VERSION,
  ANALYTICS_RESULT_VERSION,
  type DatasetResult,
} from "@hermes-swarm/api-contracts/analytics";
import type { RunHandlerContext } from "@hermes-swarm/agent-sdk";
import type { AnalyticsArtifactStorage } from "../storage/analytics-artifact-storage.js";
import type { AnalyticsQueryExecutor } from "./analytics-query-executor.js";
import { AnalyticsQueryRunHandler } from "./analytics-query-run.handler.js";
import {
  AnalyticsQueryRunHandlerError,
  type AnalyticsArtifactCandidate,
  type AnalyticsQueryRunStore,
  type AuthorizedAnalysisQueryRun,
} from "./analytics-query-run.types.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const ARTIFACT_ID = "33333333-3333-4333-8333-333333333333";
const FILE_ID = "44444444-4444-4444-8444-444444444444";
const DIGEST = "a".repeat(64);

describe("AnalyticsQueryRunHandler", () => {
  it("stores a bounded result inline", async () => {
    const state = createState(resultWithRows(1));
    const outcome = await state.handler.execute(state.context);

    assert.deepEqual(outcome, { status: "succeeded" });
    assert.equal(state.inline.length, 1);
    assert.equal(state.reservations.length, 0);
    assert.equal(state.uploads.length, 0);
  });

  it("reserves, uploads and fences a larger result artifact", async () => {
    const state = createState(resultWithRows(500, "x".repeat(700)), true);
    const outcome = await state.handler.execute(state.context);

    assert.deepEqual(outcome, { status: "succeeded" });
    assert.equal(state.inline.length, 0);
    assert.equal(state.reservations.length, 1);
    assert.equal(state.uploads.length, 1);
    assert.equal(state.completedArtifacts.length, 1);
    assert.equal(state.completedArtifacts[0]?.artifactId, ARTIFACT_ID);
    assert.equal(state.completedArtifacts[0]?.fileObjectId, FILE_ID);
    assert.match(state.completedArtifacts[0]?.sha256 ?? "", /^[a-f0-9]{64}$/);
  });

  it("fails closed when a large result needs disabled storage", async () => {
    const state = createState(resultWithRows(500, "x".repeat(700)), false);
    const outcome = await state.handler.execute(state.context);

    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.equal(outcome.failure.code, "ANALYTICS_ARTIFACT_UNAVAILABLE");
    assert.equal(outcome.failure.retryable, false);
    assert.deepEqual(state.failures, [
      { errorCode: "ANALYTICS_ARTIFACT_UNAVAILABLE", status: "failed" },
    ]);
  });

  it("returns an already completed run without repeating side effects", async () => {
    const state = createState(resultWithRows(1));
    state.alreadySucceeded = true;

    assert.deepEqual(await state.handler.execute(state.context), {
      status: "succeeded",
    });
    assert.equal(state.executeCount, 0);
    assert.equal(state.inline.length, 0);
  });

  it("settles an aborted run as cancelled", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Runtime run cancelling."));
    const state = createState(resultWithRows(1), true, controller.signal);

    assert.deepEqual(await state.handler.execute(state.context), {
      status: "cancelled",
    });
    assert.deepEqual(state.failures, [{ errorCode: null, status: "cancelled" }]);
  });

  it("retries an infrastructure abort without cancelling the query run", async () => {
    const controller = new AbortController();
    controller.abort(new Error("Runtime worker shutdown deadline exceeded."));
    const state = createState(resultWithRows(1), true, controller.signal);

    const outcome = await state.handler.execute(state.context);

    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.equal(outcome.failure.code, "ANALYTICS_QUERY_RUN_UNAVAILABLE");
    assert.equal(outcome.failure.retryable, true);
    assert.deepEqual(state.failures, []);
  });

  it("settles a retryable failure when the durable attempt budget is exhausted", async () => {
    const state = createState(resultWithRows(1));
    state.remainingAttempts = false;
    state.executeError = new AnalyticsQueryRunHandlerError(
      "ANALYTICS_ARTIFACT_UNAVAILABLE",
      true,
      "storage unavailable",
    );

    const outcome = await state.handler.execute(state.context);

    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.equal(outcome.failure.retryable, false);
    assert.deepEqual(state.failures, [
      { errorCode: "ANALYTICS_ARTIFACT_UNAVAILABLE", status: "failed" },
    ]);
  });

  it("retries an unexpected infrastructure error by default", async () => {
    const state = createState(resultWithRows(1));
    state.executeError = new Error("connection reset");

    const outcome = await state.handler.execute(state.context);

    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.equal(outcome.failure.code, "ANALYTICS_QUERY_RUN_UNAVAILABLE");
    assert.equal(outcome.failure.retryable, true);
    assert.deepEqual(state.failures, []);
  });

  it("retries an unclassified PostgreSQL error and settles its final attempt", async () => {
    const state = createState(resultWithRows(1));
    state.executeError = Object.assign(new Error("database restarting"), {
      code: "57P01",
    });

    const retryOutcome = await state.handler.execute(state.context);
    assert.equal(retryOutcome.status, "failed");
    if (retryOutcome.status !== "failed") return;
    assert.equal(retryOutcome.failure.code, "ANALYTICS_QUERY_RUN_UNAVAILABLE");
    assert.equal(retryOutcome.failure.retryable, true);
    assert.deepEqual(state.failures, []);

    state.remainingAttempts = false;
    const finalOutcome = await state.handler.execute(state.context);
    assert.equal(finalOutcome.status, "failed");
    if (finalOutcome.status !== "failed") return;
    assert.equal(finalOutcome.failure.code, "ANALYTICS_QUERY_RUN_UNAVAILABLE");
    assert.equal(finalOutcome.failure.retryable, false);
    assert.deepEqual(state.failures, [
      { errorCode: "ANALYTICS_QUERY_RUN_UNAVAILABLE", status: "failed" },
    ]);
  });
});

function createState(
  result: DatasetResult,
  storageEnabled = true,
  signal: AbortSignal = new AbortController().signal,
) {
  const inline: DatasetResult[] = [];
  const reservations: AnalyticsArtifactCandidate[] = [];
  const completedArtifacts: Array<
    AnalyticsArtifactCandidate & {
      artifactId: string;
      etag: string | null;
      fileObjectId: string;
    }
  > = [];
  const failures: Array<{
    errorCode: string | null;
    status: "cancelled" | "failed" | "timedOut";
  }> = [];
  const uploads: Buffer[] = [];
  const state = {
    alreadySucceeded: false,
    completedArtifacts,
    context: {
      lease: {
        fencingGeneration: 1,
        runId: RUN_ID,
        workspaceId: WORKSPACE_ID,
      },
      signal,
    } satisfies RunHandlerContext,
    executeCount: 0,
    executeError: null as unknown,
    failures,
    inline,
    reservations,
    remainingAttempts: true,
    uploads,
  };
  const store: AnalyticsQueryRunStore = {
    async completeArtifact(_context, input) {
      completedArtifacts.push(input);
    },
    async completeInline(_context, input) {
      inline.push(input.result);
    },
    hasRemainingAttempts() {
      return state.remainingAttempts;
    },
    async prepare() {
      return state.alreadySucceeded
        ? { kind: "already-succeeded" as const }
        : { kind: "execute" as const, run: authorizedRun() };
    },
    async reserveArtifact(_context, input) {
      reservations.push(input);
      return {
        artifactId: ARTIFACT_ID,
        bucket: "hermes-artifacts",
        fileObjectId: FILE_ID,
        objectKey: "analytics/run/result.json",
      };
    },
    async settleFailure(_context, input) {
      failures.push(input);
    },
  };
  const executor: AnalyticsQueryExecutor = {
    async execute() {
      state.executeCount += 1;
      if (state.executeError) throw state.executeError;
      return result;
    },
  };
  const storage: AnalyticsArtifactStorage = {
    bucket: storageEnabled ? "hermes-artifacts" : "",
    enabled: storageEnabled,
    async put(input) {
      uploads.push(input.body);
      return { etag: "etag-1" };
    },
  };
  return Object.assign(state, {
    handler: new AnalyticsQueryRunHandler(store, executor, storage),
  });
}

function authorizedRun(): AuthorizedAnalysisQueryRun {
  return {
    actorId: "55555555-5555-4555-8555-555555555555",
    integrationTokenId: null,
    locale: "zh-Hans",
    policyRevision: "support.tickets-policy:v1",
    principalType: "workspace",
    query: {
      filters: [],
      groupBy: [],
      measures: [],
      page: { size: 500 },
      schemaVersion: ANALYTICS_QUERY_VERSION,
      select: ["status"],
      sort: [],
      sourceKey: "support.tickets",
      sourceRevision: "support.tickets/v1",
    },
    queryDigest: DIGEST,
    requestId: "request-1",
    sourceKey: "support.tickets",
    sourceRevision: "support.tickets/v1",
    timeZone: "UTC",
    workspaceId: WORKSPACE_ID,
  };
}

function resultWithRows(count: number, suffix = ""): DatasetResult {
  const rows = Array.from({ length: count }, (_, index) => ({
    status: `${index % 2 === 0 ? "open" : "closed"}${suffix}`,
  }));
  return {
    lineage: {
      generatedAt: new Date().toISOString(),
      policyDigest: DIGEST,
      queryDigest: DIGEST,
      sourceKey: "support.tickets",
      sourceRevision: "support.tickets/v1",
    },
    pageInfo: { hasMore: false, nextCursor: null },
    rows,
    schema: [
      {
        key: "status",
        label: "Status",
        nullable: false,
        scalarType: "enum",
      },
    ],
    schemaVersion: ANALYTICS_RESULT_VERSION,
    summary: { durationMs: 1, returnedRows: count, truncated: false },
  };
}
