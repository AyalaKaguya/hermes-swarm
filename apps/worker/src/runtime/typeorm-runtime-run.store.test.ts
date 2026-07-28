import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRuntimeDispatchEnvelope } from "@hermes-swarm/agent-sdk";
import { TypeOrmRuntimeRunStore } from "./typeorm-runtime-run.store.js";
import type { ClaimedRuntimeRun } from "./runtime-run.types.js";

describe("TypeOrmRuntimeRunStore", () => {
  it("claims only through the locked Outbox-to-Run workspace join", async () => {
    const calls: QueryCall[] = [];
    const manager = testManager(calls, (sql) => {
        if (sql.includes('FROM "runtime_outbox_messages"')) {
          return [runRow({ deadline_at: new Date(6_000) })];
        }
        if (sql.includes('"status" = \'running\'')) {
          return [{ id: runRow().run_id }];
        }
        return [];
      });
    const store = transactionStore(manager);

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
    assertStatusChanges(calls, [
      { from: "queued", reasonCode: null, to: "running" },
    ]);
  });

  it("persists an active cancellation transition before deferring delivery", async () => {
    const calls: QueryCall[] = [];
    const manager = testManager(calls, (sql) => {
      if (sql.includes('FROM "runtime_outbox_messages"')) {
        return [
          runRow({
            cancellation_requested_at: new Date(500),
            lease_expires_at: new Date(2_000),
            status: "running",
          }),
        ];
      }
      if (sql.includes('"status" = \'cancelling\'')) {
        return [{ id: runRow().run_id }];
      }
      return [];
    });
    const store = transactionStore(manager);

    const result = await store.claim(envelope(), {
      leaseMs: 30_000,
      rearmIfDeferred: false,
    });

    assert.equal(result.kind, "deferred");
    assertStatusChanges(calls, [
      { from: "running", reasonCode: null, to: "cancelling" },
    ]);
  });

  it("settles a queued cancellation without invoking a handler", async () => {
    const calls: QueryCall[] = [];
    const manager = testManager(calls, (sql) => {
        if (sql.includes('FROM "runtime_outbox_messages"')) {
          return [
            runRow({ cancellation_requested_at: new Date(500) }),
          ];
        }
        if (sql.includes('"status" = $3')) return [{ id: runRow().run_id }];
        return [];
      });
    const store = transactionStore(manager);

    const result = await store.claim(envelope(), {
      leaseMs: 30_000,
      rearmIfDeferred: false,
    });

    assert.deepEqual(result, { kind: "ignored", reason: "cancelled" });
    const finish = calls.find((call) => call.sql.includes('"status" = $3'))!;
    assert.equal(finish.parameters[2], "cancelled");
    assert.match(finish.sql, /"lease_token" = NULL/);
    assertStatusChanges(calls, [
      { from: "queued", reasonCode: null, to: "cancelled" },
    ]);
  });

  it("settles an expired deadline before attempting a claim", async () => {
    const calls: QueryCall[] = [];
    const manager = testManager(calls, (sql) => {
        if (sql.includes('FROM "runtime_outbox_messages"')) {
          return [runRow({ deadline_at: new Date(999) })];
        }
        if (sql.includes('"status" = $3')) return [{ id: runRow().run_id }];
        return [];
      });
    const store = transactionStore(manager);

    const result = await store.claim(envelope(), {
      leaseMs: 30_000,
      rearmIfDeferred: false,
    });

    assert.deepEqual(result, { kind: "ignored", reason: "timed-out" });
    const finish = calls.find((call) => call.sql.includes('"status" = $3'))!;
    assert.equal(finish.parameters[2], "timedOut");
    assert.equal(finish.parameters[4], "RUNTIME_RUN_DEADLINE_EXCEEDED");
    assertStatusChanges(calls, [
      {
        from: "queued",
        reasonCode: "RUNTIME_RUN_DEADLINE_EXCEEDED",
        to: "timedOut",
      },
    ]);
  });

  it("requeues the Run and rearms the same durable Outbox atomically", async () => {
    const calls: QueryCall[] = [];
    const manager = testManager(calls, (sql) => {
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
      });
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
    const runUpdate = calls.find((call) =>
      call.sql.includes('"status" = \'queued\''),
    );
    assert.match(
      runUpdate?.sql ?? "",
      /"available_at" = \$5 \+[\s\S]*\$6::bigint/,
    );
    assert.deepEqual(runUpdate?.parameters[4], requeueRow().database_now);
    assert.equal(runUpdate?.parameters[5], 1_000);
    assertStatusChanges(calls, [
      {
        from: "running",
        reasonCode: "MODEL_TEMPORARILY_UNAVAILABLE",
        to: "queued",
      },
    ]);
  });

  it("persists both transitions when a missing Outbox fails a requeued Run", async () => {
    const calls: QueryCall[] = [];
    const manager = testManager(calls, (sql) => {
      if (sql.includes('FROM "runtime_runs" AS runtime_run')) {
        return [requeueRow()];
      }
      if (sql.includes('"status" = \'queued\',')) {
        return [{ available_at: new Date(2_000), id: claimedRun().runId }];
      }
      if (sql.includes('UPDATE "runtime_outbox_messages"')) return [];
      if (sql.includes('"status" = \'failed\',')) {
        return [{ id: claimedRun().runId }];
      }
      return [];
    });
    const store = transactionStore(manager);

    const result = await store.requeue(claimedRun(), {
      errorCode: "MODEL_TEMPORARILY_UNAVAILABLE",
      rearmOutbox: true,
      retryBackoffMs: 1_000,
    });

    assert.equal(result, "finished");
    assertStatusChanges(calls, [
      {
        from: "running",
        reasonCode: "MODEL_TEMPORARILY_UNAVAILABLE",
        to: "queued",
      },
      {
        from: "queued",
        reasonCode: "RUNTIME_RUN_OUTBOX_MISSING",
        to: "failed",
      },
    ]);
  });

  it("rejects an out-of-range retry backoff before durable mutation", async () => {
    const manager = testManager([], () => assert.fail("query should not run"));
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
    const store = transactionStore(testManager(calls, () => []));

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
    assertStatusChanges(calls, []);
  });

  it("persists the actual fenced completion transition", async () => {
    const calls: QueryCall[] = [];
    const store = transactionStore(
      testManager(calls, () => [
        statusTransitionRow({ to_status: "succeeded" }),
      ]),
    );

    const updated = await store.finish(claimedRun(), { status: "succeeded" });

    assert.equal(updated, true);
    assertStatusChanges(calls, [
      { from: "running", reasonCode: null, to: "succeeded" },
    ]);
  });

  it("uses one database clock statement for heartbeat lease decisions", async () => {
    const calls: QueryCall[] = [];
    const store = transactionStore(
      testManager(calls, () => [statusTransitionRow()]),
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
    assertStatusChanges(calls, []);
  });

  it("persists a deadline transition selected by heartbeat", async () => {
    const calls: QueryCall[] = [];
    const store = transactionStore(
      testManager(calls, () => [
        statusTransitionRow({ to_status: "timedOut" }),
      ]),
    );

    const result = await store.heartbeat(claimedRun(), { leaseMs: 30_000 });

    assert.equal(result, "timed-out");
    assertStatusChanges(calls, [
      {
        from: "running",
        reasonCode: "RUNTIME_RUN_DEADLINE_EXCEEDED",
        to: "timedOut",
      },
    ]);
  });

  it("settles stale delivery recovery when the locked Run is terminal", async () => {
    const calls: QueryCall[] = [];
    const manager = testManager(calls, () => {
        return [
          staleDeliveryRow({
            run_lease_expires_at: null,
            run_lease_token: null,
            run_status: "succeeded",
          }),
        ];
      });
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
    const manager = testManager(calls, () => {
        return [
          staleDeliveryRow({
            run_lease_expires_at: new Date(2_000),
            run_lease_generation: 6,
            run_lease_token: "018f80c0-0000-7000-8000-000000000006",
          }),
        ];
      });
    const store = transactionStore(manager);

    const result = await store.recoverStaleDelivery(claimedRun());

    assert.equal(result, "ownedElsewhere");
    assert.equal(calls.length, 1);
  });

  it("durably rearms stale delivery with no active lease", async () => {
    const calls: QueryCall[] = [];
    const manager = testManager(calls, (sql) => {
        if (sql.includes('UPDATE "runtime_outbox_messages"')) {
          return [{ id: claimedRun().dispatchId }];
        }
        return [staleDeliveryRow()];
      });
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
    const manager = testManager([], (sql) =>
        sql.includes('UPDATE "runtime_outbox_messages"')
          ? []
          : [staleDeliveryRow({ outbox_status: "dead" })],
      );
    const store = transactionStore(manager);

    await assert.rejects(
      () => store.recoverStaleDelivery(claimedRun()),
      /stale_delivery_outbox/,
    );
  });
});

type QueryCall = { parameters: unknown[]; sql: string };

function testManager(
  calls: QueryCall[],
  resultFor: (sql: string, parameters: unknown[]) => unknown,
) {
  return {
    queryRunner: { isTransactionActive: true },
    query: async (sql: string, parameters: unknown[]) => {
      calls.push({ parameters, sql });
      const eventRows = runtimeEventRows(sql, parameters);
      return eventRows ?? resultFor(sql, parameters);
    },
  };
}

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

function assertStatusChanges(
  calls: QueryCall[],
  expected: Array<{ from: string; reasonCode: string | null; to: string }>,
) {
  assert.deepEqual(
    calls
      .filter((call) => call.sql.includes('INSERT INTO "runtime_run_events"'))
      .map((call) => ({
        from: call.parameters[2],
        reasonCode: call.parameters[4],
        to: call.parameters[3],
      })),
    expected,
  );
}

function runtimeEventRows(sql: string, parameters: unknown[]) {
  if (!sql.includes('INSERT INTO "runtime_run_events"')) return null;
  const sequence = 1;
  const type = parameters[6];
  const now = new Date(1_000);
  return [
    {
      callId: null,
      createdAt: now,
      eventKey: `${String(type)}:${sequence}`,
      id: "018f80c0-0000-7000-8000-000000000009",
      nodeId: null,
      occurredAt: now,
      payload: {
        from: parameters[2],
        reasonCode: parameters[4],
        to: parameters[3],
      },
      runId: parameters[1],
      schemaVersion: parameters[5],
      sequence,
      type,
      updatedAt: now,
      workspaceId: parameters[0],
    },
  ];
}

function statusTransitionRow(overrides: Record<string, unknown> = {}) {
  return {
    from_status: "running",
    reason_code: null,
    run_id: claimedRun().runId,
    to_status: "running",
    workspace_id: claimedRun().workspaceId,
    ...overrides,
  };
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
