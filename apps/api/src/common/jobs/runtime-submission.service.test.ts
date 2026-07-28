import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RuntimeOutboxMessage,
  RuntimeRun,
} from "@hermes-swarm/core";
import type { EntityManager } from "typeorm";
import { WorkspaceContextService } from "../database/workspace-context.service.js";
import { RuntimeSubmissionService } from "./runtime-submission.service.js";
import {
  RUNTIME_CANCELLATION_NOT_FOUND_CODE,
  RUNTIME_SUBMISSION_CONFLICT_CODE,
  RuntimeCancellationNotFoundError,
  RuntimeSubmissionConflictError,
  RuntimeSubmissionValidationError,
  type RuntimeSubmissionInput,
} from "./runtime-submission.types.js";

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const UNKNOWN_RUN_ID = "33333333-3333-4333-8333-333333333333";
const AVAILABLE_AT = new Date("2026-07-25T10:00:00.000Z");
const CANCELLATION_AT = new Date("2026-07-25T10:05:00.000Z");

describe("RuntimeSubmissionService", () => {
  it("derives workspace ownership from context and isolates A/B submissions", async () => {
    const state = createState();
    const input = submissionInput();

    const first = await state.context.run(
      { scopeLevel: "workspace", workspaceId: WORKSPACE_A },
      () => state.service.submitInTransaction(state.manager, input),
    );
    const second = await state.context.run(
      { scopeLevel: "workspace", workspaceId: WORKSPACE_B },
      () => state.service.submitInTransaction(state.manager, input),
    );

    assert.equal(first.run.workspaceId, WORKSPACE_A);
    assert.equal(first.outbox.workspaceId, WORKSPACE_A);
    assert.equal(second.run.workspaceId, WORKSPACE_B);
    assert.equal(second.outbox.workspaceId, WORKSPACE_B);
    assert.notEqual(first.run.id, second.run.id);
    assert.deepEqual(
      state.runs.map(({ workspaceId }) => workspaceId),
      [WORKSPACE_A, WORKSPACE_B],
    );
  });

  it("returns the existing run and outbox for the same request digest", async () => {
    const state = createState();
    const input = submissionInput();

    const first = await submitForWorkspace(state, WORKSPACE_A, input);
    const duplicate = await submitForWorkspace(state, WORKSPACE_A, input);

    assert.equal(first.deduplicated, false);
    assert.equal(duplicate.deduplicated, true);
    assert.equal(duplicate.run.id, first.run.id);
    assert.equal(duplicate.outbox.id, first.outbox.id);
    assert.equal(state.runs.length, 1);
    assert.equal(state.outbox.length, 1);
  });

  it("rejects reuse of an idempotency key for a different request digest", async () => {
    const state = createState();
    await submitForWorkspace(state, WORKSPACE_A, submissionInput());

    await assert.rejects(
      () =>
        submitForWorkspace(state, WORKSPACE_A, {
          ...submissionInput(),
          requestDigest: "b".repeat(64),
        }),
      (error: unknown) => {
        assert.ok(error instanceof RuntimeSubmissionConflictError);
        assert.equal(error.code, RUNTIME_SUBMISSION_CONFLICT_CODE);
        return true;
      },
    );
    assert.equal(state.runs.length, 1);
    assert.equal(state.outbox.length, 1);
  });

  it("rejects stronger transaction isolation before taking the advisory lock", async () => {
    for (const isolationLevel of ["repeatable read", "serializable"]) {
      const state = createState({ isolationLevel });

      await assert.rejects(
        () => submitForWorkspace(state, WORKSPACE_A, submissionInput()),
        RuntimeSubmissionValidationError,
      );
      assert.equal(state.advisoryLocks.length, 0);
      assert.equal(state.repositoryEntities.length, 0);
      assert.equal(state.runs.length, 0);
      assert.match(
        state.queries[0] ?? "",
        /SHOW transaction_isolation/,
      );
    }
  });

  it("uses only caller-manager repositories and emits the minimal SDK envelope", async () => {
    const state = createState();
    const result = await submitForWorkspace(
      state,
      WORKSPACE_A,
      submissionInput(),
    );

    assert.deepEqual(state.repositoryEntities, [RuntimeRun, RuntimeOutboxMessage]);
    assert.equal(state.advisoryLocks.length, 1);
    assert.deepEqual(Object.keys(result.outbox.payload).sort(), [
      "dispatchId",
      "runId",
      "schemaVersion",
    ]);
    assert.deepEqual(result.outbox.payload, {
      dispatchId: result.outbox.id,
      runId: result.run.id,
      schemaVersion: "hermes.runtime-dispatch/v1",
    });
    assert.equal("workspaceId" in result.outbox.payload, false);
    assert.equal("requestDigest" in result.outbox.payload, false);
    assert.equal("correlationId" in result.outbox.payload, false);
  });

  it("surfaces an outbox failure so the caller transaction rolls back both writes", async () => {
    const state = createState({ failOutboxSave: new Error("outbox unavailable") });

    await assert.rejects(
      () =>
        state.transaction(() =>
          submitForWorkspace(state, WORKSPACE_A, submissionInput()),
        ),
      /outbox unavailable/,
    );
    assert.equal(state.runs.length, 0);
    assert.equal(state.outbox.length, 0);
  });

  it("fails closed without an active transaction or with caller-supplied workspace data", async () => {
    const state = createState();
    state.transactionActive.value = false;
    await assert.rejects(
      () => submitForWorkspace(state, WORKSPACE_A, submissionInput()),
      RuntimeSubmissionValidationError,
    );

    state.transactionActive.value = true;
    await assert.rejects(
      () =>
        submitForWorkspace(state, WORKSPACE_A, {
          ...submissionInput(),
          workspaceId: WORKSPACE_B,
        } as RuntimeSubmissionInput),
      RuntimeSubmissionValidationError,
    );
    assert.equal(state.runs.length, 0);
  });

  it("requires a bounded namespaced run kind", async () => {
    const state = createState();

    for (const runKind of ["agent", "agent.", "agent_execute", "Agent.execute"]) {
      await assert.rejects(
        () =>
          submitForWorkspace(state, WORKSPACE_A, {
            ...submissionInput(),
            runKind,
          }),
        RuntimeSubmissionValidationError,
      );
    }
    assert.equal(state.runs.length, 0);
  });

  it("immediately finishes queued and waiting cancellations using database time", async () => {
    for (const initialStatus of ["queued", "waiting"] as const) {
      const state = createState();
      const submitted = await submitForWorkspace(
        state,
        WORKSPACE_A,
        submissionInput(),
      );
      submitted.run.status = initialStatus;

      const cancelled = await cancelForWorkspace(
        state,
        WORKSPACE_A,
        submitted.run.id,
      );

      assert.strictEqual(cancelled, submitted.run);
      assert.equal(cancelled.status, "cancelled");
      assert.deepEqual(cancelled.cancellationRequestedAt, CANCELLATION_AT);
      assert.deepEqual(cancelled.finishedAt, CANCELLATION_AT);
      assert.equal(cancelled.lastErrorCode, null);
      assert.equal(cancelled.leaseToken, null);
      assert.equal(cancelled.leaseOwner, null);
      assert.equal(cancelled.leaseExpiresAt, null);
      assert.equal(cancelled.heartbeatAt, null);
      assert.equal(cancelled.eventSequence, 1);
      assert.deepEqual(state.statusChanges, [
        {
          from: initialStatus,
          reasonCode: "user",
          runId: submitted.run.id,
          to: "cancelled",
          workspaceId: WORKSPACE_A,
        },
      ]);
      assert.deepEqual(state.runLocks, [{ mode: "pessimistic_write" }]);
    }
  });

  it("moves a running run to cancelling without releasing its lease", async () => {
    const state = createState();
    const submitted = await submitForWorkspace(
      state,
      WORKSPACE_A,
      submissionInput(),
    );
    const lease = {
      heartbeatAt: new Date("2026-07-25T10:04:00.000Z"),
      leaseExpiresAt: new Date("2026-07-25T10:06:00.000Z"),
      leaseOwner: "worker-1",
      leaseToken: "44444444-4444-4444-8444-444444444444",
    };
    Object.assign(submitted.run, {
      ...lease,
      startedAt: new Date("2026-07-25T10:01:00.000Z"),
      status: "running",
    });

    const cancelling = await cancelForWorkspace(
      state,
      WORKSPACE_A,
      submitted.run.id,
    );

    assert.equal(cancelling.status, "cancelling");
    assert.deepEqual(cancelling.cancellationRequestedAt, CANCELLATION_AT);
    assert.equal(cancelling.finishedAt, null);
    assert.strictEqual(cancelling.heartbeatAt, lease.heartbeatAt);
    assert.strictEqual(cancelling.leaseExpiresAt, lease.leaseExpiresAt);
    assert.equal(cancelling.leaseOwner, lease.leaseOwner);
    assert.equal(cancelling.leaseToken, lease.leaseToken);
    assert.equal(cancelling.eventSequence, 1);
    assert.deepEqual(state.statusChanges, [
      {
        from: "running",
        reasonCode: "user",
        runId: submitted.run.id,
        to: "cancelling",
        workspaceId: WORKSPACE_A,
      },
    ]);

    const saveCount = state.runSaveCalls.length;
    const requestedAt = cancelling.cancellationRequestedAt;
    const repeated = await cancelForWorkspace(
      state,
      WORKSPACE_A,
      submitted.run.id,
    );
    assert.strictEqual(repeated, cancelling);
    assert.strictEqual(repeated.cancellationRequestedAt, requestedAt);
    assert.equal(state.runSaveCalls.length, saveCount);
  });

  it("leaves terminal runs unchanged on repeated cancellation", async () => {
    for (const terminalStatus of [
      "cancelled",
      "failed",
      "succeeded",
      "timedOut",
    ] as const) {
      const state = createState();
      const submitted = await submitForWorkspace(
        state,
        WORKSPACE_A,
        submissionInput(),
      );
      const finishedAt = new Date("2026-07-25T10:03:00.000Z");
      submitted.run.status = terminalStatus;
      submitted.run.finishedAt = finishedAt;
      const saveCount = state.runSaveCalls.length;

      const result = await cancelForWorkspace(
        state,
        WORKSPACE_A,
        submitted.run.id,
      );

      assert.strictEqual(result, submitted.run);
      assert.equal(result.status, terminalStatus);
      assert.strictEqual(result.finishedAt, finishedAt);
      assert.equal(state.runSaveCalls.length, saveCount);
    }
  });

  it("fails closed identically for unknown and cross-workspace run ids", async () => {
    const state = createState();
    const submitted = await submitForWorkspace(
      state,
      WORKSPACE_A,
      submissionInput(),
    );

    for (const [workspaceId, runId] of [
      [WORKSPACE_A, UNKNOWN_RUN_ID],
      [WORKSPACE_B, submitted.run.id],
    ] as const) {
      await assert.rejects(
        () => cancelForWorkspace(state, workspaceId, runId),
        (error: unknown) => {
          assert.ok(error instanceof RuntimeCancellationNotFoundError);
          assert.equal(error.code, RUNTIME_CANCELLATION_NOT_FOUND_CODE);
          return true;
        },
      );
    }
    assert.equal(submitted.run.status, "queued");
    assert.equal(submitted.run.cancellationRequestedAt, null);
  });

  it("rejects cancellation outside an active transaction", async () => {
    const state = createState();
    state.transactionActive.value = false;

    await assert.rejects(
      () => cancelForWorkspace(state, WORKSPACE_A, UNKNOWN_RUN_ID),
      RuntimeSubmissionValidationError,
    );
    assert.equal(state.repositoryEntities.length, 0);
  });
});

function submissionInput(): RuntimeSubmissionInput {
  return {
    availableAt: AVAILABLE_AT,
    correlationId: "request-20260725-1",
    deadlineAt: new Date("2026-07-25T10:30:00.000Z"),
    idempotencyKey: "runtime-request-1",
    maxAttempts: 4,
    requestDigest: "a".repeat(64),
    runKind: "agent.execute",
  };
}

function submitForWorkspace(
  state: ReturnType<typeof createState>,
  workspaceId: string,
  input: RuntimeSubmissionInput,
) {
  return state.context.run(
    { scopeLevel: "workspace", workspaceId },
    () => state.service.submitInTransaction(state.manager, input),
  );
}

function cancelForWorkspace(
  state: ReturnType<typeof createState>,
  workspaceId: string,
  runId: string,
) {
  return state.context.run(
    { scopeLevel: "workspace", workspaceId },
    () => state.service.requestCancellationInTransaction(state.manager, runId),
  );
}

function createState(
  options: {
    databaseNow?: Date;
    failOutboxSave?: Error;
    isolationLevel?: string;
  } = {},
) {
  const context = new WorkspaceContextService();
  const runs: RuntimeRun[] = [];
  const outbox: RuntimeOutboxMessage[] = [];
  const repositoryEntities: unknown[] = [];
  const advisoryLocks: unknown[][] = [];
  const queries: string[] = [];
  const runLocks: unknown[] = [];
  const runSaveCalls: RuntimeRun[] = [];
  const statusChanges: Array<{
    from: string;
    reasonCode: string | null;
    runId: string;
    to: string;
    workspaceId: string;
  }> = [];
  const transactionActive = { value: true };

  const runRepository = {
    create: (value: Partial<RuntimeRun>) => Object.assign(new RuntimeRun(), value),
    findOne: async ({
      lock,
      where,
    }: {
      lock?: unknown;
      where: Partial<RuntimeRun>;
    }) => {
      if (lock) runLocks.push(lock);
      return runs.find((run) => matchesRuntimeRun(run, where)) ?? null;
    },
    save: async (value: RuntimeRun) => {
      runSaveCalls.push(value);
      const existingIndex = runs.findIndex((run) => run.id === value.id);
      if (existingIndex === -1) runs.push(value);
      else runs[existingIndex] = value;
      return value;
    },
  };
  const outboxRepository = {
    create: (value: Partial<RuntimeOutboxMessage>) =>
      Object.assign(new RuntimeOutboxMessage(), value),
    findOne: async ({ where }: { where: Partial<RuntimeOutboxMessage> }) =>
      outbox.find(
        (message) =>
          message.workspaceId === where.workspaceId &&
          message.runId === where.runId &&
          message.topic === where.topic,
      ) ?? null,
    save: async (value: RuntimeOutboxMessage) => {
      if (options.failOutboxSave) throw options.failOutboxSave;
      outbox.push(value);
      return value;
    },
  };
  const manager = {
    get queryRunner() {
      return { isTransactionActive: transactionActive.value };
    },
    getRepository(entity: unknown) {
      repositoryEntities.push(entity);
      if (entity === RuntimeRun) return runRepository;
      if (entity === RuntimeOutboxMessage) return outboxRepository;
      throw new Error("Unexpected repository");
    },
    async query(sql: string, parameters: unknown[] = []) {
      queries.push(sql);
      if (sql.includes("SHOW transaction_isolation")) {
        return [
          {
            transaction_isolation:
              options.isolationLevel ?? "read committed",
          },
        ];
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        advisoryLocks.push(parameters);
        return [];
      }
      if (sql.includes('INSERT INTO "runtime_run_events"')) {
        const [workspaceId, runId, from, to, reasonCode, schemaVersion, type] =
          parameters as [string, string, string, string, string | null, string, string];
        const run = runs.find(
          (candidate) =>
            candidate.id === runId && candidate.workspaceId === workspaceId,
        );
        if (!run || run.status !== to) return [];
        run.eventSequence = (run.eventSequence ?? 0) + 1;
        const now = new Date(
          (options.databaseNow ?? CANCELLATION_AT).getTime(),
        );
        statusChanges.push({ from, reasonCode, runId, to, workspaceId });
        return [
          {
            callId: null,
            createdAt: now,
            eventKey: `${type}:${run.eventSequence}`,
            id: `99999999-9999-4999-8999-${run.eventSequence
              .toString()
              .padStart(12, "0")}`,
            nodeId: null,
            occurredAt: now,
            payload: { from, reasonCode, to },
            runId,
            schemaVersion,
            sequence: run.eventSequence,
            type,
            updatedAt: now,
            workspaceId,
          },
        ];
      }
      if (sql.includes("clock_timestamp()")) {
        return [
          {
            databaseNow: new Date(
              (options.databaseNow ?? CANCELLATION_AT).getTime(),
            ),
          },
        ];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
  } as unknown as EntityManager;
  const state = {
    advisoryLocks,
    context,
    manager,
    outbox,
    queries,
    repositoryEntities,
    runLocks,
    runSaveCalls,
    runs,
    service: new RuntimeSubmissionService(context),
    statusChanges,
    transactionActive,
    async transaction<T>(work: () => Promise<T>) {
      const runCount = runs.length;
      const outboxCount = outbox.length;
      try {
        return await work();
      } catch (error) {
        runs.splice(runCount);
        outbox.splice(outboxCount);
        throw error;
      }
    },
  };
  return state;
}

function matchesRuntimeRun(run: RuntimeRun, where: Partial<RuntimeRun>) {
  const record = run as unknown as Record<string, unknown>;
  return Object.entries(where).every(([key, value]) => record[key] === value);
}
