import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRuntimeDispatchEnvelope } from "@hermes-swarm/agent-sdk";
import { TypeOrmRuntimeRunStore } from "./typeorm-runtime-run.store.js";
import type { ClaimedRuntimeRun } from "./runtime-run.types.js";

describe("TypeOrmRuntimeRunStore", () => {
  it("claims only through the locked Outbox-to-Run workspace join", async () => {
    const calls: QueryCall[] = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ parameters, sql });
        if (sql.includes('FROM "runtime_outbox_messages"')) {
          return [runRow({ deadline_at: new Date(6_000) })];
        }
        if (sql.includes('"status" = \'running\'')) {
          return [{ id: runRow().run_id }];
        }
        return [];
      },
    };
    const store = new TypeOrmRuntimeRunStore(
      {
        transaction: async (work: (value: typeof manager) => Promise<unknown>) =>
          work(manager),
      } as never,
      { id: "worker-a" },
    );

    const result = await store.claim(envelope(), {
      leaseMs: 30_000,
      rearmIfDeferred: false,
    });

    assert.equal(result.kind, "claimed");
    if (result.kind !== "claimed") assert.fail("expected a claimed run");
    assert.equal(result.run.workspaceId, runRow().workspace_id);
    assert.equal(result.run.fencingGeneration, 5);
    assert.equal(result.run.attempt, 2);
    assert.equal(result.run.deadlineDelayMs, 5_000);
    assert.match(calls[0]?.sql ?? "", /INNER JOIN "runtime_runs"/);
    assert.match(
      calls[0]?.sql ?? "",
      /runtime_run\."workspace_id" = message\."workspace_id"/,
    );
    assert.match(calls[0]?.sql ?? "", /FOR UPDATE OF message, runtime_run/);
    assert.match(calls[0]?.sql ?? "", /message\."status" <> 'dead'/);
    assert.match(calls[0]?.sql ?? "", /clock_timestamp\(\)/);
    assert.match(calls[1]?.sql ?? "", /"workspace_id" = \$2/);
    assert.equal(calls[1]?.parameters[1], runRow().workspace_id);
    assert.deepEqual(calls[1]?.parameters[3], runRow().database_now);
  });

  it("settles a queued cancellation without invoking a handler", async () => {
    const calls: QueryCall[] = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ parameters, sql });
        if (sql.includes('FROM "runtime_outbox_messages"')) {
          return [
            runRow({ cancellation_requested_at: new Date(500) }),
          ];
        }
        if (sql.includes('"status" = $3')) return [{ id: runRow().run_id }];
        return [];
      },
    };
    const store = transactionStore(manager);

    const result = await store.claim(envelope(), {
      leaseMs: 30_000,
      rearmIfDeferred: false,
    });

    assert.deepEqual(result, { kind: "ignored", reason: "cancelled" });
    const finish = calls.at(-1)!;
    assert.equal(finish.parameters[2], "cancelled");
    assert.match(finish.sql, /"lease_token" = NULL/);
  });

  it("settles an expired deadline before attempting a claim", async () => {
    const calls: QueryCall[] = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ parameters, sql });
        if (sql.includes('FROM "runtime_outbox_messages"')) {
          return [runRow({ deadline_at: new Date(999) })];
        }
        if (sql.includes('"status" = $3')) return [{ id: runRow().run_id }];
        return [];
      },
    };
    const store = transactionStore(manager);

    const result = await store.claim(envelope(), {
      leaseMs: 30_000,
      rearmIfDeferred: false,
    });

    assert.deepEqual(result, { kind: "ignored", reason: "timed-out" });
    const finish = calls.at(-1)!;
    assert.equal(finish.parameters[2], "timedOut");
    assert.equal(finish.parameters[4], "RUNTIME_RUN_DEADLINE_EXCEEDED");
  });

  it("requeues the Run and rearms the same durable Outbox atomically", async () => {
    const calls: QueryCall[] = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ parameters, sql });
        if (sql.includes('FROM "runtime_runs" AS runtime_run')) {
          return [requeueRow()];
        }
        if (sql.includes('"status" = \'queued\'')) {
          return [
            {
              available_at: new Date(2_000),
              id: claimedRun().runId,
            },
          ];
        }
        if (sql.includes('UPDATE "runtime_outbox_messages"')) {
          return [{ id: claimedRun().dispatchId }];
        }
        return [];
      },
    };
    const store = transactionStore(manager);

    const result = await store.requeue(claimedRun(), {
      errorCode: "MODEL_TEMPORARILY_UNAVAILABLE",
      rearmOutbox: true,
      retryBackoffMs: 1_000,
    });

    assert.equal(result, "requeued");
    const outbox = calls.find((call) =>
      call.sql.includes('UPDATE "runtime_outbox_messages"'),
    );
    assert.ok(outbox);
    assert.match(outbox.sql, /"published_at" = NULL/);
    assert.match(outbox.sql, /"workspace_id" = \$3/);
    assert.equal(outbox.parameters[2], claimedRun().workspaceId);
    assert.deepEqual(outbox.parameters[3], new Date(2_000));
    const lock = calls[0];
    assert.match(lock?.sql ?? "", /clock_timestamp\(\)/);
    assert.match(
      lock?.sql ?? "",
      /"lease_expires_at" > database_clock\."now"/,
    );
    assert.equal(lock?.parameters.some((value) => value instanceof Date), false);
    const runUpdate = calls[1];
    assert.match(
      runUpdate?.sql ?? "",
      /"available_at" = \$5 \+[\s\S]*\$6::bigint/,
    );
    assert.deepEqual(runUpdate?.parameters[4], requeueRow().database_now);
    assert.equal(runUpdate?.parameters[5], 1_000);
  });

  it("rejects an out-of-range retry backoff before durable mutation", async () => {
    const manager = {
      query: async () => assert.fail("query should not run"),
    };
    const store = transactionStore(manager);

    await assert.rejects(
      () =>
        store.requeue(claimedRun(), {
          errorCode: "MODEL_TEMPORARILY_UNAVAILABLE",
          rearmOutbox: false,
          retryBackoffMs: 30_001,
        }),
      /retryBackoffMs/,
    );
  });

  it("rejects a stale completion through token, generation, and workspace fences", async () => {
    const calls: QueryCall[] = [];
    const store = new TypeOrmRuntimeRunStore(
      {
        query: async (sql: string, parameters: unknown[]) => {
          calls.push({ parameters, sql });
          return [];
        },
      } as never,
      { id: "worker-a" },
    );

    const updated = await store.finish(claimedRun(), { status: "succeeded" });

    assert.equal(updated, false);
    assert.match(calls[0]?.sql ?? "", /"workspace_id" = \$2/);
    assert.match(calls[0]?.sql ?? "", /"lease_token" = \$3/);
    assert.match(calls[0]?.sql ?? "", /"lease_generation" = \$4/);
    assert.match(calls[0]?.sql ?? "", /clock_timestamp\(\)/);
    assert.match(
      calls[0]?.sql ?? "",
      /"lease_expires_at" > database_clock\."now"/,
    );
    assert.equal(
      calls[0]?.parameters.some((value) => value instanceof Date),
      false,
    );
  });

  it("uses one database clock statement for heartbeat lease decisions", async () => {
    const calls: QueryCall[] = [];
    const store = new TypeOrmRuntimeRunStore(
      {
        query: async (sql: string, parameters: unknown[]) => {
          calls.push({ parameters, sql });
          return [{ status: "running" }];
        },
      } as never,
      { id: "worker-a" },
    );

    const result = await store.heartbeat(claimedRun(), { leaseMs: 30_000 });

    assert.equal(result, "active");
    assert.match(calls[0]?.sql ?? "", /WITH database_clock AS MATERIALIZED/);
    assert.match(calls[0]?.sql ?? "", /clock_timestamp\(\)/);
    assert.match(
      calls[0]?.sql ?? "",
      /"lease_expires_at" > database_clock\."now"/,
    );
    assert.equal(calls[0]?.parameters[4], 30_000);
    assert.equal(
      calls[0]?.parameters.some((value) => value instanceof Date),
      false,
    );
  });

  it("settles stale delivery recovery when the locked Run is terminal", async () => {
    const calls: QueryCall[] = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ parameters, sql });
        return [
          staleDeliveryRow({
            run_lease_expires_at: null,
            run_lease_token: null,
            run_status: "succeeded",
          }),
        ];
      },
    };
    const store = transactionStore(manager);

    const result = await store.recoverStaleDelivery(claimedRun());

    assert.equal(result, "settled");
    assert.equal(calls.length, 1);
    assert.match(calls[0]?.sql ?? "", /clock_timestamp\(\)/);
    assert.match(calls[0]?.sql ?? "", /FOR UPDATE OF message, runtime_run/);
    assert.match(calls[0]?.sql ?? "", /message\."workspace_id" = \$3/);
    assert.equal(calls[0]?.parameters[2], claimedRun().workspaceId);
  });

  it("leaves stale delivery recovery with a different active lease owner", async () => {
    const calls: QueryCall[] = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ parameters, sql });
        return [
          staleDeliveryRow({
            run_lease_expires_at: new Date(2_000),
            run_lease_generation: 6,
            run_lease_token: "018f80c0-0000-7000-8000-000000000006",
          }),
        ];
      },
    };
    const store = transactionStore(manager);

    const result = await store.recoverStaleDelivery(claimedRun());

    assert.equal(result, "ownedElsewhere");
    assert.equal(calls.length, 1);
  });

  it("durably rearms stale delivery with no active lease", async () => {
    const calls: QueryCall[] = [];
    const manager = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ parameters, sql });
        if (sql.includes('UPDATE "runtime_outbox_messages"')) {
          return [{ id: claimedRun().dispatchId }];
        }
        return [staleDeliveryRow()];
      },
    };
    const store = transactionStore(manager);

    const result = await store.recoverStaleDelivery(claimedRun());

    assert.equal(result, "rearmed");
    const update = calls[1];
    assert.match(update?.sql ?? "", /"status" = 'pending'/);
    assert.match(update?.sql ?? "", /"published_at" = NULL/);
    assert.match(update?.sql ?? "", /GREATEST\([\s\S]*clock_timestamp\(\)/);
    assert.match(update?.sql ?? "", /"workspace_id" = \$3/);
    assert.match(
      update?.sql ?? "",
      /"status" IN \('pending', 'publishing', 'published'\)/,
    );
    assert.equal(update?.parameters[2], claimedRun().workspaceId);
    assert.deepEqual(update?.parameters[4], staleDeliveryRow().database_now);
  });

  it("throws when stale delivery cannot be durably rearmed", async () => {
    const manager = {
      query: async (sql: string) =>
        sql.includes('UPDATE "runtime_outbox_messages"')
          ? []
          : [staleDeliveryRow({ outbox_status: "dead" })],
    };
    const store = transactionStore(manager);

    await assert.rejects(
      () => store.recoverStaleDelivery(claimedRun()),
      /stale_delivery_outbox/,
    );
  });
});

type QueryCall = { parameters: unknown[]; sql: string };

function transactionStore(manager: {
  query(sql: string, parameters: unknown[]): Promise<unknown>;
}) {
  return new TypeOrmRuntimeRunStore(
    {
      transaction: async (work: (value: typeof manager) => Promise<unknown>) =>
        work(manager),
    } as never,
    { id: "worker-a" },
  );
}

function envelope() {
  return createRuntimeDispatchEnvelope({
    dispatchId: runRow().dispatch_id,
    runId: runRow().run_id,
  });
}

function claimedRun(): ClaimedRuntimeRun {
  return {
    attempt: 1,
    deadlineDelayMs: null,
    dispatchId: runRow().dispatch_id,
    fencingGeneration: 5,
    leaseToken: "018f80c0-0000-7000-8000-000000000005",
    maxAttempts: 3,
    runId: runRow().run_id,
    runKind: "agent.graph",
    workspaceId: runRow().workspace_id,
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    attempt_count: 1,
    available_at: new Date(0),
    cancellation_requested_at: null,
    database_now: new Date(1_000),
    deadline_at: null,
    dispatch_id: "018f80c0-0000-7000-8000-000000000001",
    lease_expires_at: null,
    lease_generation: 4,
    max_attempts: 3,
    run_id: "018f80c0-0000-7000-8000-000000000002",
    run_kind: "agent.graph",
    status: "queued",
    workspace_id: "018f80c0-0000-7000-8000-000000000003",
    ...overrides,
  };
}

function requeueRow(overrides: Record<string, unknown> = {}) {
  return {
    attempt_count: 1,
    cancellation_requested_at: null,
    database_now: new Date(1_000),
    deadline_at: null,
    max_attempts: 3,
    status: "running",
    ...overrides,
  };
}

function staleDeliveryRow(overrides: Record<string, unknown> = {}) {
  return {
    database_now: new Date(1_000),
    outbox_status: "published",
    run_available_at: new Date(0),
    run_lease_expires_at: new Date(999),
    run_lease_generation: claimedRun().fencingGeneration,
    run_lease_token: claimedRun().leaseToken,
    run_status: "running",
    ...overrides,
  };
}
