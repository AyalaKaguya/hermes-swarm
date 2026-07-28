import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RunEventSchema } from "@hermes-swarm/api-contracts/ai";
import {
  ANALYTICS_QUERY_VERSION,
  type AnalysisQuery,
} from "@hermes-swarm/api-contracts/analytics";
import {
  AnalysisQueryRun,
  DatasetArtifact,
  FileObject,
  RuntimeRun,
} from "@hermes-swarm/core";
import {
  ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
  DATASET_ARTIFACT_SCHEMA_VERSION,
  analyticsDigest,
} from "@hermes-swarm/core/analytics";
import type { RunHandlerContext } from "@hermes-swarm/agent-sdk";
import { TrustedRunContextService } from "../runtime/trusted-run-context.service.js";
import type { ClaimedRuntimeRun } from "../runtime/runtime-run.types.js";
import type { AnalyticsArtifactStorage } from "../storage/analytics-artifact-storage.js";
import { AnalyticsQueryRunHandler } from "./analytics-query-run.handler.js";
import {
  AnalyticsQueryRunHandlerError,
  type AnalyticsArtifactCandidate,
} from "./analytics-query-run.types.js";
import { TypeOrmAnalyticsQueryRunStore } from "./typeorm-analytics-query-run.store.js";

const REQUIRED_PERMISSIONS = [
  "analytics.ticket_dataset.query:workspace",
  "analytics.ticket_dataset.query_run_submit:workspace",
] as const;

describe("TypeOrmAnalyticsQueryRunStore", () => {
  it("requires query and query_run_submit from active account membership", async () => {
    const harness = storeHarness();

    const prepared = await harness.run((context) =>
      harness.store.prepare(context),
    );

    assert.equal(prepared.kind, "execute");
    assert.deepEqual(harness.operations.slice(0, 3), [
      "lock-runtime-run",
      "lock-analysis-query-run",
      "database-clock",
    ]);
    const authorization = requiredCall(harness.calls, 'FROM "user_workspace_roles"');
    assert.deepEqual(sortedStrings(authorization.parameters[2]), [
      ...REQUIRED_PERMISSIONS,
    ].sort());
    assert.match(authorization.sql, /COUNT\(DISTINCT permission\."code"\)/);
    assert.match(authorization.sql, /= cardinality\(\$3::varchar\[\]\)/);
    assert.match(authorization.sql, /membership\."status" = 'active'/);
    assert.match(authorization.sql, /INNER JOIN "workspaces" workspace/);
    assert.match(
      authorization.sql,
      /workspace\."status" IN \('active', 'provisioning'\)/,
    );
    assert.match(authorization.sql, /workspace\."deleted_at" IS NULL/);
    assert.equal(
      harness.calls.some((call) => call.sql.includes('FROM "integration_tokens"')),
      false,
    );
  });

  it("requires both permissions again from the integration token", async () => {
    const harness = storeHarness({
      queryRun: queryRun({
        integrationTokenId: INTEGRATION_TOKEN_ID,
        principalType: "integration",
      }),
    });

    const prepared = await harness.run((context) =>
      harness.store.prepare(context),
    );

    assert.equal(prepared.kind, "execute");
    const membership = requiredCall(
      harness.calls,
      'FROM "user_workspace_roles"',
    );
    assert.deepEqual(sortedStrings(membership.parameters[2]), [
      ...REQUIRED_PERMISSIONS,
    ].sort());
    const token = requiredCall(harness.calls, 'FROM "integration_tokens"');
    assert.match(token.sql, /"expires_at" > clock_timestamp\(\)/);
    assert.match(token.sql, /"permissions" @> \$4::jsonb/);
    assert.equal(token.parameters[1], INTEGRATION_TOKEN_ID);
    assert.deepEqual(
      sortedStrings(JSON.parse(String(token.parameters[3]))),
      [...REQUIRED_PERMISSIONS].sort(),
    );
  });

  it("fails closed when the trusted workspace is no longer available", async () => {
    const harness = storeHarness({ authorizationRows: [] });

    await assert.rejects(
      () => harness.run((context) => harness.store.prepare(context)),
      (error) => hasStoreCode(error, "ANALYTICS_FEATURE_DISABLED"),
    );
  });

  it("bounds a new pending artifact and its file by the configured pending TTL", async () => {
    const resultExpiresAt = new Date(CLOCK.getTime() + 24 * 60 * 60 * 1_000);
    const candidate = artifactCandidate("9");
    const harness = storeHarness({
      queryRun: queryRun({ expiresAt: resultExpiresAt, status: "running" }),
    });

    const reservation = await harness.run((context) =>
      harness.store.reserveArtifact(context, {
        ...candidate,
        bucket: "hermes-artifacts",
      }),
    );

    const pendingFile = harness.created.find(
      (created) => created.target === FileObject,
    )?.value;
    const pendingArtifact = harness.created.find(
      (created) => created.target === DatasetArtifact,
    )?.value;
    const pendingExpiresAt = new Date(CLOCK.getTime() + 60_000);
    assert.deepEqual(pendingFile?.expiresAt, pendingExpiresAt);
    assert.deepEqual(pendingArtifact?.expiresAt, pendingExpiresAt);
    assert.equal(pendingArtifact?.fileObjectId, reservation.fileObjectId);
  });

  it("replaces a pending FileObject and refreshes retry candidate metadata", async () => {
    const existingArtifact = artifact({
      byteSize: 10,
      expiresAt: new Date(CLOCK.getTime() + 120_000),
      lineage: artifactCandidate("1").lineage,
      preview: [{ status: "old" }],
      resultSchema: artifactCandidate("1").resultSchema,
      rowCount: 1,
      sha256: "1".repeat(64),
    });
    const existingFile = fileObject({
      bucket: "old-artifacts",
      byteSize: 10,
      etag: "stale-etag",
      failureCode: "UPLOAD_FAILED",
      sha256: "1".repeat(64),
    });
    const supersededExpiresAt = existingFile.expiresAt;
    const candidate = artifactCandidate("b", {
      byteSize: 2_048,
      preview: [{ status: "new" }, { status: "closed" }],
      rowCount: 2,
    });
    const harness = storeHarness({
      artifact: existingArtifact,
      file: existingFile,
      queryRun: queryRun({ status: "running" }),
    });

    const reservation = await harness.run((context) =>
      harness.store.reserveArtifact(context, {
        ...candidate,
        bucket: "new-artifacts",
      }),
    );

    assert.equal(reservation.artifactId, ARTIFACT_ID);
    assert.equal(reservation.bucket, "new-artifacts");
    assert.notEqual(reservation.fileObjectId, FILE_ID);
    assert.notEqual(reservation.objectKey, "analytics/results/result.json");
    assert.equal(harness.created.length, 1);
    assert.equal(harness.created[0]?.target, FileObject);
    const replacement = harness.created[0]?.value;
    assert.equal(replacement?.id, reservation.fileObjectId);
    assert.equal(replacement?.objectKey, reservation.objectKey);
    assert.equal(replacement?.bucket, "new-artifacts");
    assert.equal(replacement?.byteSize, candidate.byteSize);
    assert.equal(replacement?.status, "pending");
    assert.equal(replacement?.failureCode, null);
    assert.deepEqual(
      replacement?.expiresAt,
      new Date(CLOCK.getTime() + 60_000),
    );
    assert.equal(existingFile.id, FILE_ID);
    assert.equal(existingFile.objectKey, "analytics/results/result.json");
    assert.equal(existingFile.bucket, "old-artifacts");
    assert.equal(existingFile.byteSize, 10);
    assert.equal(existingFile.status, "failed");
    assert.equal(
      existingFile.failureCode,
      "ANALYTICS_ARTIFACT_SUPERSEDED",
    );
    assert.equal(existingFile.expiresAt, supersededExpiresAt);
    assert.equal(existingArtifact.id, ARTIFACT_ID);
    assert.equal(existingArtifact.fileObjectId, reservation.fileObjectId);
    assert.equal(existingArtifact.byteSize, candidate.byteSize);
    assert.equal(existingArtifact.rowCount, candidate.rowCount);
    assert.equal(existingArtifact.sha256, candidate.sha256);
    assert.deepEqual(
      existingArtifact.expiresAt,
      new Date(CLOCK.getTime() + 60_000),
    );
    assert.deepEqual(existingArtifact.lineage, candidate.lineage);
    assert.deepEqual(existingArtifact.resultSchema, candidate.resultSchema);
    assert.deepEqual(existingArtifact.preview, candidate.preview);
    assert.deepEqual(
      harness.saved.map((write) => write.target),
      [FileObject, FileObject, DatasetArtifact],
    );

    const writesBeforeLateCompletion = harness.saved.length;
    await assert.rejects(
      () =>
        harness.run(
          (context) =>
            harness.store.completeArtifact(context, {
              ...candidate,
              artifactId: ARTIFACT_ID,
              etag: "late-etag",
              fileObjectId: FILE_ID,
            }),
          { fencingGeneration: 1, leaseToken: OLD_LEASE_TOKEN },
        ),
      (error) => hasStoreCode(error, "ANALYTICS_QUERY_RUN_STALE_LEASE"),
    );
    assert.equal(harness.saved.length, writesBeforeLateCompletion);
  });

  it("persists the last retryable failure when attempts are exhausted", async () => {
    const pendingArtifact = artifact();
    const run = queryRun({ status: "running" });
    const harness = storeHarness({ artifact: pendingArtifact, queryRun: run });
    const handler = new AnalyticsQueryRunHandler(
      harness.store,
      {
        async execute() {
          throw new AnalyticsQueryRunHandlerError(
            "ANALYTICS_ARTIFACT_UNAVAILABLE",
            true,
            "object storage unavailable",
          );
        },
      },
      unusedStorage(),
    );

    const outcome = await harness.run(
      (context) => handler.execute(context),
      { attempt: 3, maxAttempts: 3 },
    );

    assert.equal(outcome.status, "failed");
    if (outcome.status !== "failed") return;
    assert.equal(outcome.failure.code, "ANALYTICS_ARTIFACT_UNAVAILABLE");
    assert.equal(outcome.failure.retryable, false);
    assert.equal(run.status, "failed");
    assert.equal(run.failureCode, "ANALYTICS_ARTIFACT_UNAVAILABLE");
    assert.deepEqual(run.failedAt, CLOCK);
    assert.equal(pendingArtifact.status, "failed");
    assert.equal(
      pendingArtifact.failureCode,
      "ANALYTICS_ARTIFACT_UNAVAILABLE",
    );
    assert.deepEqual(pendingArtifact.failedAt, CLOCK);
    assert.deepEqual(
      pendingArtifact.expiresAt,
      new Date(CLOCK.getTime() + 60_000),
    );
    assert.deepEqual(
      harness.saved.map((write) => write.target),
      [AnalysisQueryRun, AnalysisQueryRun, DatasetArtifact],
    );
  });

  it("prioritizes cancellation and deadline over an ordinary failure", async () => {
    const cancellationRun = queryRun({
      cancellingAt: new Date(CLOCK.getTime() - 2_000),
      status: "cancelling",
    });
    const cancellation = storeHarness({
      artifact: null,
      queryRun: cancellationRun,
      runtimeRun: runtimeRun({
        cancellationRequestedAt: new Date(CLOCK.getTime() - 2_000),
        deadlineAt: new Date(CLOCK.getTime() - 1_000),
        status: "cancelling",
      }),
    });

    await cancellation.run((context) =>
      cancellation.store.settleFailure(context, {
        errorCode: "ANALYTICS_ADAPTER_UNAVAILABLE",
        status: "failed",
      }),
    );
    assert.equal(cancellationRun.status, "cancelled");
    assert.equal(cancellationRun.failureCode, null);
    assert.deepEqual(cancellationRun.cancelledAt, CLOCK);
    assert.equal(cancellationRun.failedAt, null);
    assert.equal(cancellationRun.timedOutAt, null);

    const mismatchedRun = queryRun({
      cancellingAt: new Date(CLOCK.getTime() - 2_000),
      status: "cancelling",
    });
    const mismatched = storeHarness({
      artifact: null,
      queryRun: mismatchedRun,
      runtimeRun: runtimeRun(),
    });
    await assert.rejects(
      () =>
        mismatched.run((context) =>
          mismatched.store.settleFailure(context, {
            errorCode: "ANALYTICS_ADAPTER_UNAVAILABLE",
            status: "failed",
          }),
        ),
      (error) => hasStoreCode(error, "ANALYTICS_QUERY_RUN_STALE_LEASE"),
    );
    assert.equal(mismatchedRun.status, "cancelling");
    assert.equal(mismatchedRun.failedAt, null);
    assert.equal(mismatched.saved.length, 0);

    const deadlineRun = queryRun({ status: "running" });
    const deadline = storeHarness({
      artifact: null,
      queryRun: deadlineRun,
      runtimeRun: runtimeRun({
        deadlineAt: new Date(CLOCK.getTime() - 1),
      }),
    });
    await deadline.run((context) =>
      deadline.store.settleFailure(context, {
        errorCode: "ANALYTICS_ADAPTER_UNAVAILABLE",
        status: "failed",
      }),
    );
    assert.equal(deadlineRun.status, "timedOut");
    assert.equal(deadlineRun.failureCode, "ANALYTICS_QUERY_TIMEOUT");
    assert.deepEqual(deadlineRun.timedOutAt, CLOCK);
    assert.equal(deadlineRun.failedAt, null);

    const cancellingDeadlineRun = queryRun({
      cancellingAt: new Date(CLOCK.getTime() - 2_000),
      status: "cancelling",
    });
    const cancellingDeadline = storeHarness({
      artifact: null,
      queryRun: cancellingDeadlineRun,
      runtimeRun: runtimeRun({
        deadlineAt: new Date(CLOCK.getTime() - 1),
      }),
    });
    await cancellingDeadline.run((context) =>
      cancellingDeadline.store.settleFailure(context, {
        errorCode: "ANALYTICS_ADAPTER_UNAVAILABLE",
        status: "failed",
      }),
    );
    assert.equal(cancellingDeadlineRun.status, "timedOut");
    assert.equal(
      cancellingDeadlineRun.failureCode,
      "ANALYTICS_QUERY_TIMEOUT",
    );
    assert.equal(cancellingDeadlineRun.failedAt, null);
  });

  it("rejects ordinary execution after the database deadline", async () => {
    const run = queryRun();
    const harness = storeHarness({
      queryRun: run,
      runtimeRun: runtimeRun({ deadlineAt: CLOCK }),
    });

    await assert.rejects(
      () => harness.run((context) => harness.store.prepare(context)),
      (error) => hasStoreCode(error, "ANALYTICS_QUERY_TIMEOUT", false),
    );
    assert.equal(run.status, "queued");
    assert.equal(harness.saved.length, 0);
  });

  it("emits an artifact.created payload accepted by the RunEvent contract", async () => {
    const candidate = artifactCandidate("c");
    const resultExpiresAt = new Date(CLOCK.getTime() + 24 * 60 * 60 * 1_000);
    const reservedArtifact = artifact({
      ...candidate,
      expiresAt: new Date(CLOCK.getTime() + 120_000),
      status: "pending",
    });
    const reservedFile = fileObject({
      expiresAt: new Date(CLOCK.getTime() + 60_000),
    });
    const harness = storeHarness({
      artifact: reservedArtifact,
      file: reservedFile,
      queryRun: queryRun({ expiresAt: resultExpiresAt, status: "running" }),
    });

    await harness.run((context) =>
      harness.store.completeArtifact(context, {
        ...candidate,
        artifactId: ARTIFACT_ID,
        etag: '"etag-1"',
        fileObjectId: FILE_ID,
      }),
    );

    assert.deepEqual(reservedFile.expiresAt, resultExpiresAt);
    assert.deepEqual(reservedArtifact.expiresAt, resultExpiresAt);

    const inserted = requiredCall(
      harness.calls,
      'INSERT INTO "runtime_run_events"',
    );
    assert.match(inserted.sql, /'artifactType', 'table'/);
    assert.match(inserted.sql, /'title', 'Analytics query result'/);
    assert.match(inserted.sql, /'fileObjectId', \$9::uuid/);
    assert.match(
      inserted.sql,
      /runtime_run\."deadline_at" IS NULL[\s\S]*runtime_run\."deadline_at" > database_clock\."now"/,
    );
    const event = {
      callId: null,
      eventKey: inserted.parameters[5],
      id: EVENT_ID,
      nodeId: null,
      occurredAt: CLOCK.toISOString(),
      payload: {
        artifactId: inserted.parameters[7],
        artifactType: "table",
        fileObjectId: inserted.parameters[8],
        title: "Analytics query result",
      },
      runId: RUN_ID,
      schemaVersion: inserted.parameters[4],
      sequence: 1,
      type: inserted.parameters[6],
      workspaceId: WORKSPACE_ID,
    };
    assert.equal(RunEventSchema.safeParse(event).success, true);
    assert.deepEqual(event.payload, {
      artifactId: ARTIFACT_ID,
      artifactType: "table",
      fileObjectId: FILE_ID,
      title: "Analytics query result",
    });
  });
});

type QueryCall = { parameters: unknown[]; sql: string };
type SavedWrite = { snapshot: Record<string, unknown>; target: Function };
type HarnessOptions = {
  artifact?: DatasetArtifact | null;
  authorizationRows?: readonly Record<string, unknown>[];
  file?: FileObject | null;
  queryRun?: AnalysisQueryRun;
  runtimeRun?: RuntimeRun;
  tokenAllowed?: boolean;
};

function storeHarness(options: HarnessOptions = {}) {
  const calls: QueryCall[] = [];
  const created: Array<{ target: Function; value: Record<string, unknown> }> = [];
  const operations: string[] = [];
  const saved: SavedWrite[] = [];
  const trusted = new TrustedRunContextService();
  const state = {
    artifact: options.artifact === undefined ? null : options.artifact,
    file: options.file === undefined ? null : options.file,
    queryRun: options.queryRun ?? queryRun(),
    runtimeRun: options.runtimeRun ?? runtimeRun(),
  };
  const manager = {
    create(target: Function, value: Record<string, unknown>) {
      created.push({ target, value: structuredClone(value) });
      return Object.assign(Object.create(target.prototype), value);
    },
    async findOne(target: Function) {
      if (target === RuntimeRun) {
        operations.push("lock-runtime-run");
        return state.runtimeRun;
      }
      if (target === AnalysisQueryRun) {
        operations.push("lock-analysis-query-run");
        return state.queryRun;
      }
      if (target === DatasetArtifact) {
        operations.push("lock-dataset-artifact");
        return state.artifact;
      }
      if (target === FileObject) {
        operations.push("lock-file-object");
        return state.file;
      }
      return null;
    },
    async query(sql: string, parameters: unknown[] = []) {
      calls.push({ parameters, sql });
      if (sql.trimStart().startsWith("SELECT clock_timestamp()")) {
        operations.push("database-clock");
        return [{ database_now: CLOCK }];
      }
      if (sql.includes('FROM "user_workspace_roles"')) {
        return options.authorizationRows ?? [
          {
            allowed: true,
            feature_enabled: "true",
            preferred_language: "zh-Hans",
            time_zone: "UTC",
          },
        ];
      }
      if (sql.includes('FROM "integration_tokens"')) {
        return [{ allowed: options.tokenAllowed ?? true }];
      }
      if (sql.includes('INSERT INTO "runtime_run_events"')) {
        return [{ id: EVENT_ID }];
      }
      assert.fail(`Unexpected SQL: ${sql}`);
    },
    async save(target: Function, value: Record<string, unknown>) {
      saved.push({ snapshot: structuredClone(value), target });
      return value;
    },
  };
  const dataSource = {
    async transaction<T>(work: (value: typeof manager) => Promise<T>) {
      return work(manager);
    },
  };
  const store = new TypeOrmAnalyticsQueryRunStore(
    dataSource as never,
    trusted,
    {
      getOrThrow() {
        return { objectStorage: { pendingTtlSeconds: 60 } };
      },
    } as never,
  );
  return {
    calls,
    created,
    operations,
    saved,
    store,
    run<T>(
      work: (context: RunHandlerContext) => Promise<T>,
      claimedOverrides: Partial<ClaimedRuntimeRun> = {},
    ) {
      return trusted.run(
        claimedRun(claimedOverrides),
        new AbortController().signal,
        work,
      );
    },
  };
}

function requiredCall(calls: QueryCall[], needle: string) {
  const call = calls.find((candidate) => candidate.sql.includes(needle));
  assert.ok(call, `Expected SQL containing ${needle}`);
  return call;
}

function sortedStrings(value: unknown) {
  assert.ok(Array.isArray(value));
  assert.equal(value.every((item) => typeof item === "string"), true);
  return [...value].sort() as string[];
}

function hasStoreCode(error: unknown, code: string, retryable = false) {
  return (
    error instanceof AnalyticsQueryRunHandlerError &&
    error.code === code &&
    error.retryable === retryable
  );
}

const QUERY: AnalysisQuery = {
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

function queryRun(overrides: Partial<AnalysisQueryRun> = {}) {
  return Object.assign(new AnalysisQueryRun(), {
    cancelledAt: null,
    cancellingAt: null,
    createdAt: new Date(CLOCK.getTime() - 5_000),
    expiresAt: new Date(CLOCK.getTime() + 60_000),
    failedAt: null,
    failureCode: null,
    id: RUN_ID,
    inlineResult: null,
    integrationTokenId: null,
    normalizedQuery: QUERY,
    policyDigest: null,
    policyRevision: "support.tickets-policy:v1",
    principalType: "workspace" as const,
    queryDigest: analyticsDigest(QUERY),
    queuedAt: new Date(CLOCK.getTime() - 4_000),
    requestId: "request-1",
    requestedByAccountId: ACCOUNT_ID,
    schemaVersion: ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
    sourceKey: QUERY.sourceKey,
    sourceRevision: QUERY.sourceRevision,
    startedAt: null,
    status: "queued" as const,
    succeededAt: null,
    timedOutAt: null,
    updatedAt: new Date(CLOCK.getTime() - 4_000),
    waitingAt: null,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  });
}

function runtimeRun(overrides: Partial<RuntimeRun> = {}) {
  return Object.assign(new RuntimeRun(), {
    cancellationRequestedAt: null,
    deadlineAt: null,
    id: RUN_ID,
    leaseExpiresAt: new Date(CLOCK.getTime() + 60_000),
    leaseGeneration: 2,
    leaseToken: LEASE_TOKEN,
    status: "running" as const,
    workspaceId: WORKSPACE_ID,
    ...overrides,
  });
}

function artifact(overrides: Partial<DatasetArtifact> = {}) {
  const candidate = artifactCandidate("a");
  return Object.assign(new DatasetArtifact(), {
    ...candidate,
    createdAt: new Date(CLOCK.getTime() - 2_000),
    expiresAt: new Date(CLOCK.getTime() + 60_000),
    failedAt: null,
    failureCode: null,
    fileObjectId: FILE_ID,
    id: ARTIFACT_ID,
    queryRunId: RUN_ID,
    readyAt: null,
    schemaVersion: DATASET_ARTIFACT_SCHEMA_VERSION,
    status: "pending" as const,
    updatedAt: new Date(CLOCK.getTime() - 1_000),
    workspaceId: WORKSPACE_ID,
    ...overrides,
  });
}

function fileObject(overrides: Partial<FileObject> = {}) {
  return Object.assign(new FileObject(), {
    bucket: "hermes-artifacts",
    byteSize: 512,
    etag: null,
    expiresAt: new Date(CLOCK.getTime() + 60_000),
    failureCode: null,
    id: FILE_ID,
    objectKey: "analytics/results/result.json",
    purpose: "artifact" as const,
    retention: "temporary" as const,
    scopeType: "workspace" as const,
    sha256: null,
    status: "pending" as const,
    updatedAt: new Date(CLOCK.getTime() - 1_000),
    workspaceId: WORKSPACE_ID,
    ...overrides,
  });
}

function artifactCandidate(
  digestCharacter: string,
  overrides: Partial<AnalyticsArtifactCandidate> = {},
): AnalyticsArtifactCandidate {
  return {
    byteSize: 512,
    lineage: {
      generatedAt: CLOCK.toISOString(),
      policyDigest: digestCharacter.repeat(64),
      queryDigest: analyticsDigest(QUERY),
      sourceKey: QUERY.sourceKey,
      sourceRevision: QUERY.sourceRevision,
    },
    preview: [{ status: "open" }],
    resultSchema: [
      {
        key: "status",
        label: "Status",
        nullable: false,
        scalarType: "enum",
      },
    ],
    rowCount: 1,
    sha256: digestCharacter.repeat(64),
    ...overrides,
  };
}

function claimedRun(
  overrides: Partial<ClaimedRuntimeRun> = {},
): ClaimedRuntimeRun {
  return {
    attempt: 1,
    deadlineDelayMs: null,
    dispatchId: DISPATCH_ID,
    fencingGeneration: 2,
    leaseToken: LEASE_TOKEN,
    maxAttempts: 3,
    runId: RUN_ID,
    runKind: "analytics.query",
    workspaceId: WORKSPACE_ID,
    ...overrides,
  };
}

function unusedStorage(): AnalyticsArtifactStorage {
  return {
    bucket: "hermes-artifacts",
    enabled: true,
    async put() {
      return assert.fail("storage must not be called after executor failure");
    },
  };
}

const CLOCK = new Date("2026-07-27T04:00:00.000Z");
const WORKSPACE_ID = "018f80c0-0000-7000-8000-000000000001";
const RUN_ID = "018f80c0-0000-7000-8000-000000000002";
const DISPATCH_ID = "018f80c0-0000-7000-8000-000000000003";
const LEASE_TOKEN = "018f80c0-0000-7000-8000-000000000004";
const OLD_LEASE_TOKEN = "018f80c0-0000-7000-8000-00000000000a";
const ACCOUNT_ID = "018f80c0-0000-7000-8000-000000000005";
const INTEGRATION_TOKEN_ID = "018f80c0-0000-7000-8000-000000000006";
const ARTIFACT_ID = "018f80c0-0000-7000-8000-000000000007";
const FILE_ID = "018f80c0-0000-7000-8000-000000000008";
const EVENT_ID = "018f80c0-0000-7000-8000-000000000009";
