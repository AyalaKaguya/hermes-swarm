import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE,
  TypeOrmOutboxStore,
} from "./typeorm-outbox.store.js";

describe("TypeOrmOutboxStore", () => {
  it("reconciles stale deliveries through SKIP LOCKED and resets successful attempts", async () => {
    const calls: Array<{ parameters: unknown[]; sql: string }> = [];
    const dataSource = {
      query: async (sql: string, parameters: unknown[]) => {
        calls.push({ parameters, sql });
        return [{ id: parameters[0] }];
      },
      transaction: async (work: (manager: unknown) => Promise<unknown>) =>
        work({
          query: async (sql: string, parameters: unknown[]) => {
            calls.push({ parameters, sql });
            if (sql.includes("RETURNING\n            message")) {
              return [
                {
                  attempt_count: 2,
                  id: "018f80c0-0000-7000-8000-000000000001",
                  lease_token: parameters[1],
                  run_id: "018f80c0-0000-7000-8000-000000000002",
                  workspace_id: "018f80c0-0000-7000-8000-000000000003",
                },
              ];
            }
            return [];
          },
        }),
    };
    const store = new TypeOrmOutboxStore(dataSource as never, {
      id: "worker-a",
    });

    const [claim] = await store.claimBatch({
      batchSize: 5,
      leaseMs: 10_000,
      reconcileMs: 60_000,
    });
    assert.ok(claim);
    assert.equal(claim.attempt, 2);
    const claimCall = calls[1]!;
    assert.match(claimCall.sql, /FOR UPDATE OF message, runtime_run SKIP LOCKED/);
    assert.match(claimCall.sql, /message\."status" = 'publishing'/);
    assert.match(
      claimCall.sql,
      /message\."lease_expires_at" <= clock_timestamp\(\)/,
    );
    assert.match(claimCall.sql, /message\."status" = 'published'/);
    assert.match(claimCall.sql, /runtime_run\."status" = 'queued'/);
    assert.match(
      claimCall.sql,
      /runtime_run\."status" IN \('running', 'cancelling'\)/,
    );
    assert.match(
      claimCall.sql,
      /runtime_run\."lease_expires_at" <= clock_timestamp\(\)/,
    );
    assert.match(claimCall.sql, /"published_at" = NULL/);
    assert.match(
      claimCall.sql,
      /"lease_expires_at" = clock_timestamp\(\)\s*\+ \(\$4::bigint/,
    );
    assert.equal(claimCall.parameters[4], 60_000);
    assert.equal(
      claimCall.parameters.some((parameter) => parameter instanceof Date),
      false,
    );

    await store.markPublished(claim);
    const finalize = calls.at(-1)!;
    assert.match(finalize.sql, /"attempt_count" = 0/);
    assert.match(finalize.sql, /"published_at" = clock_timestamp\(\)/);
    assert.match(finalize.sql, /"workspace_id" = \$3/);
    assert.match(finalize.sql, /"lease_token" = \$4/);
    assert.equal(finalize.parameters[2], claim.workspaceId);
    assert.equal(finalize.parameters[3], claim.leaseToken);
  });

  it("treats a changed fence as a stale finalizer", async () => {
    const store = new TypeOrmOutboxStore(
      { query: async () => [] } as never,
      { id: "worker-a" },
    );
    const updated = await store.markPublished(
      {
        attempt: 1,
        dispatchId: "018f80c0-0000-7000-8000-000000000001",
        leaseToken: "018f80c0-0000-7000-8000-000000000002",
        runId: "018f80c0-0000-7000-8000-000000000003",
        workspaceId: "018f80c0-0000-7000-8000-000000000004",
      },
    );
    assert.equal(updated, false);
  });

  it("recovers crash-after-enqueue-before-ack when an active Run proves delivery", async () => {
    const calls: Array<{ parameters: unknown[]; sql: string }> = [];
    let transactions = 0;
    const dataSource = {
      transaction: async (work: (manager: unknown) => Promise<unknown>) => {
        transactions += 1;
        return work({
          query: async (sql: string, parameters: unknown[]) => {
            calls.push({ parameters, sql });
            return [];
          },
        });
      },
    };
    const store = new TypeOrmOutboxStore(dataSource as never, {
      id: "worker-a",
    });

    await store.claimBatch({
      batchSize: 5,
      leaseMs: 10_000,
      reconcileMs: 60_000,
    });

    assert.equal(transactions, 1);
    const exhausted = calls[0]!;
    assert.match(exhausted.sql, /WITH exhausted AS/);
    assert.match(exhausted.sql, /message\."attempt_count" >= message\."max_attempts"/);
    assert.match(exhausted.sql, /resolved_messages AS/);
    assert.match(exhausted.sql, /UPDATE "runtime_outbox_messages" AS message/);
    assert.match(exhausted.sql, /UPDATE "runtime_runs" AS runtime_run/);
    assert.match(
      exhausted.sql,
      /FOR UPDATE OF message, runtime_run SKIP LOCKED/,
    );
    assert.match(
      exhausted.sql,
      /runtime_run\."lease_expires_at" > clock_timestamp\(\)/,
    );
    assert.match(
      exhausted.sql,
      /WHEN exhausted\."has_active_run_lease" THEN 'published'/,
    );
    assert.match(
      exhausted.sql,
      /WHEN exhausted\."has_active_run_lease" THEN 0/,
    );
    assert.match(
      exhausted.sql,
      /AND resolved_messages\."status" = 'dead'/,
    );
    assert.match(exhausted.sql, /ELSE 'dead'/);
    assert.match(exhausted.sql, /"status" = 'failed'/);
    assert.match(exhausted.sql, /"finished_at" = clock_timestamp\(\)/);
    assert.match(exhausted.sql, /"heartbeat_at" = NULL/);
    assert.match(
      exhausted.sql,
      /"status" NOT IN \(\s*'cancelled', 'failed', 'succeeded', 'timedOut'\s*\)/,
    );
    assert.equal(
      exhausted.parameters[2],
      OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE,
    );
  });

  it("fails the Run in the retry transaction when the publish attempt reaches its limit", async () => {
    const calls: Array<{ parameters: unknown[]; sql: string }> = [];
    let transactions = 0;
    const message = claimed();
    const dataSource = {
      transaction: async (work: (manager: unknown) => Promise<unknown>) => {
        transactions += 1;
        return work({
          query: async (sql: string, parameters: unknown[]) => {
            calls.push({ parameters, sql });
            if (sql.includes('UPDATE "runtime_outbox_messages"')) {
              return [
                {
                  id: message.dispatchId,
                  run_id: message.runId,
                  status: "dead",
                  workspace_id: message.workspaceId,
                },
              ];
            }
            return [];
          },
        });
      },
    };
    const store = new TypeOrmOutboxStore(dataSource as never, {
      id: "worker-a",
    });

    const released = await store.releaseForRetry(message, {
      errorCode: "RUNTIME_OUTBOX_PUBLISH_FAILED",
      retryBackoffMs: 10_000,
    });

    assert.equal(released, true);
    assert.equal(transactions, 1);
    assert.equal(calls.length, 2);
    assert.match(
      calls[0]!.sql,
      /FOR UPDATE OF message, runtime_run/,
    );
    assert.match(calls[0]!.sql, /THEN 'dead'/);
    assert.match(
      calls[0]!.sql,
      /"available_at" = clock_timestamp\(\)\s*\+ \(\$5::bigint/,
    );
    assert.match(
      calls[0]!.sql,
      /WHEN candidate\."has_active_run_lease" THEN clock_timestamp\(\)/,
    );
    assert.equal(
      calls[0]!.parameters[6],
      OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE,
    );
    assert.match(calls[1]!.sql, /UPDATE "runtime_runs"/);
    assert.match(calls[1]!.sql, /"status" = 'failed'/);
    assert.match(calls[1]!.sql, /"lease_token" = NULL/);
    assert.match(calls[1]!.sql, /"lease_owner" = NULL/);
    assert.match(calls[1]!.sql, /"lease_expires_at" = NULL/);
    assert.match(calls[1]!.sql, /"heartbeat_at" = NULL/);
    assert.match(
      calls[1]!.sql,
      /AND NOT \(\s*"status" IN \('running', 'cancelling'\)\s*AND "lease_expires_at" > clock_timestamp\(\)\s*\)/,
    );
    assert.deepEqual(calls[1]!.parameters, [
      message.runId,
      message.workspaceId,
      OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE,
    ]);
  });

  it("treats a valid Run lease as publish evidence after an ambiguous enqueue error", async () => {
    const calls: Array<{ parameters: unknown[]; sql: string }> = [];
    const message = claimed();
    const dataSource = {
      transaction: async (work: (manager: unknown) => Promise<unknown>) =>
        work({
          query: async (sql: string, parameters: unknown[]) => {
            calls.push({ parameters, sql });
            return [
              {
                id: message.dispatchId,
                run_id: message.runId,
                status: "published",
                workspace_id: message.workspaceId,
              },
            ];
          },
        }),
    };
    const store = new TypeOrmOutboxStore(dataSource as never, {
      id: "worker-a",
    });

    const released = await store.releaseForRetry(message, {
      errorCode: "RUNTIME_OUTBOX_PUBLISH_FAILED",
      retryBackoffMs: 10_000,
    });

    assert.equal(released, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0]!.sql, /FOR UPDATE OF message, runtime_run/);
    assert.match(
      calls[0]!.sql,
      /runtime_run\."status" IN \('running', 'cancelling'\)/,
    );
    assert.match(
      calls[0]!.sql,
      /runtime_run\."lease_expires_at" > clock_timestamp\(\)/,
    );
    assert.match(
      calls[0]!.sql,
      /WHEN candidate\."has_active_run_lease" THEN 'published'/,
    );
    assert.match(
      calls[0]!.sql,
      /WHEN candidate\."has_active_run_lease" THEN 0/,
    );
  });
});

function claimed() {
  return {
    attempt: 3,
    dispatchId: "018f80c0-0000-7000-8000-000000000001",
    leaseToken: "018f80c0-0000-7000-8000-000000000002",
    runId: "018f80c0-0000-7000-8000-000000000003",
    workspaceId: "018f80c0-0000-7000-8000-000000000004",
  } as const;
}
