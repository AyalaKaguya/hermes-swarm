import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";
import type {
  GraphExecutionAdapterDescriptor,
  HermesJsonValue,
  RunLease,
} from "@hermes-swarm/agent-sdk";
import {
  RUNTIME_CHECKPOINT_SCHEMA_VERSION,
  RUNTIME_RUN_EVENT_SCHEMA_VERSION,
} from "@hermes-swarm/core/runtime";
import { TrustedRunContextService } from "./trusted-run-context.service.js";
import {
  RUNTIME_CHECKPOINT_STORE_ERROR_CODES,
  RuntimeCheckpointStoreError,
  TypeOrmRuntimeCheckpointStore,
} from "./typeorm-runtime-checkpoint.store.js";
import type { ClaimedRuntimeRun } from "./runtime-run.types.js";

describe("TypeOrmRuntimeCheckpointStore", () => {
  it("atomically fences, appends, and emits a checkpoint event", async () => {
    const harness = storeHarness((sql) => {
      if (sql.includes('FROM "runtime_runs"') && sql.includes("FOR UPDATE")) {
        return [{ id: RUN_ID }];
      }
      if (sql.includes('FROM "runtime_checkpoints" AS checkpoint')) return [];
      if (sql.includes('COALESCE(MAX("sequence"), 0)')) {
        return [{ sequence: 0 }];
      }
      if (sql.includes('INSERT INTO "runtime_checkpoints"')) {
        return [checkpointRow()];
      }
      if (sql.includes('INSERT INTO "runtime_run_events"')) {
        return [{ id: EVENT_ID }];
      }
      return [];
    });

    const saved = await harness.run((lease) =>
      harness.store.save({
        adapter: ADAPTER,
        adapterCheckpointKey: CHECKPOINT_KEY,
        lease,
        lineage: [],
        namespace: "",
        parentCheckpointKey: null,
        state: STATE,
      }),
    );

    assert.equal(saved.sequence, 1);
    assert.equal(saved.adapterCheckpointKey, CHECKPOINT_KEY);
    assert.equal(harness.transactions, 1);
    const lock = harness.calls.find((call) =>
      call.sql.includes('FROM "runtime_runs"'),
    )!;
    assert.match(lock.sql, /"workspace_id" = \$1/);
    assert.match(lock.sql, /"lease_token" = \$3/);
    assert.match(lock.sql, /"lease_generation" = \$4/);
    assert.match(lock.sql, /"status" = 'running'/);
    assert.match(lock.sql, /"cancellation_requested_at" IS NULL/);
    assert.match(lock.sql, /"lease_expires_at" > clock_timestamp\(\)/);
    assert.match(
      lock.sql,
      /"deadline_at" IS NULL OR "deadline_at" > clock_timestamp\(\)/,
    );
    assert.equal(lock.parameters[2], LEASE_TOKEN);

    const event = harness.calls.find((call) =>
      call.sql.includes('INSERT INTO "runtime_run_events"'),
    )!;
    assert.match(event.sql, /"event_sequence" = runtime_run\."event_sequence" \+ 1/);
    assert.match(event.sql, /'checkpointId'/);
    assert.match(event.sql, /'checkpointSequence'/);
    assert.equal(event.parameters[4], RUNTIME_RUN_EVENT_SCHEMA_VERSION);
    assert.equal(event.parameters[6], "checkpoint.created");
    assert.match(
      event.sql,
      /runtime_run\."deadline_at" IS NULL[\s\S]*runtime_run\."deadline_at" > database_clock\."now"/,
    );
    assert.equal(event.parameters[8], 1);
  });

  it("rejects stale tokens before writing any checkpoint", async () => {
    const harness = storeHarness(() => []);

    await assert.rejects(
      () =>
        harness.run((lease) =>
          harness.store.save({
            adapter: ADAPTER,
            adapterCheckpointKey: CHECKPOINT_KEY,
            lease,
            lineage: [],
            namespace: "",
            parentCheckpointKey: null,
            state: STATE,
          }),
        ),
      (error) => hasCode(error, RUNTIME_CHECKPOINT_STORE_ERROR_CODES.staleLease),
    );
    assert.equal(
      harness.calls.some((call) =>
        call.sql.includes('INSERT INTO "runtime_checkpoints"'),
      ),
      false,
    );
  });

  it("returns an identical committed checkpoint without duplicating its event", async () => {
    const harness = storeHarness((sql) => {
      if (sql.includes('FROM "runtime_runs"') && sql.includes("FOR UPDATE")) {
        return [{ id: RUN_ID }];
      }
      if (sql.includes('FROM "runtime_checkpoints" AS checkpoint')) {
        return [checkpointRow()];
      }
      if (sql.includes("WITH RECURSIVE ancestors")) return [];
      return [];
    });

    const saved = await harness.run((lease) =>
      harness.store.save({
        adapter: ADAPTER,
        adapterCheckpointKey: CHECKPOINT_KEY,
        lease,
        lineage: [],
        namespace: "",
        parentCheckpointKey: null,
        state: STATE,
      }),
    );

    assert.equal(saved.checkpointId, CHECKPOINT_ID);
    assert.equal(saved.sequence, 1);
    assert.equal(
      harness.calls.some((call) =>
        call.sql.includes('INSERT INTO "runtime_run_events"'),
      ),
      false,
    );
  });

  it("fails closed when an idempotency key is reused with different state", async () => {
    const conflictingState = Object.freeze({ value: 2 });
    const harness = storeHarness((sql) => {
      if (sql.includes('FROM "runtime_runs"') && sql.includes("FOR UPDATE")) {
        return [{ id: RUN_ID }];
      }
      if (sql.includes('FROM "runtime_checkpoints" AS checkpoint')) {
        return [checkpointRow({ state: conflictingState })];
      }
      if (sql.includes("WITH RECURSIVE ancestors")) return [];
      return [];
    });

    await assert.rejects(
      () =>
        harness.run((lease) =>
          harness.store.save({
            adapter: ADAPTER,
            adapterCheckpointKey: CHECKPOINT_KEY,
            lease,
            lineage: [],
            namespace: "",
            parentCheckpointKey: null,
            state: STATE,
          }),
        ),
      (error) => hasCode(error, RUNTIME_CHECKPOINT_STORE_ERROR_CODES.conflict),
    );
  });

  it("persists signed pending-write indexes behind the same active lease", async () => {
    const harness = storeHarness((sql) => {
      if (sql.includes('FROM "runtime_runs"') && sql.includes("FOR UPDATE")) {
        return [{ id: RUN_ID }];
      }
      if (sql.includes('FROM "runtime_checkpoints" AS checkpoint')) {
        return [checkpointRow()];
      }
      if (sql.includes("WITH RECURSIVE ancestors")) return [];
      if (sql.includes('FROM "runtime_checkpoint_writes"')) return [];
      if (sql.includes('INSERT INTO "runtime_checkpoint_writes"')) {
        return [{ id: WRITE_ID }];
      }
      return [];
    });

    const saved = await harness.run((lease) =>
      harness.store.savePendingWrites({
        checkpoint: {
          adapterCheckpointKey: CHECKPOINT_KEY,
          checkpointId: CHECKPOINT_ID,
          namespace: "",
          sequence: 1,
        },
        lease,
        writes: [
          {
            channel: "__error__",
            index: -1,
            taskId: "task-1",
            type: "json",
            value: { data: "e30=", encoding: "base64" },
          },
        ],
      }),
    );

    assert.equal(saved.writes[0]?.index, -1);
    const insert = harness.calls.find((call) =>
      call.sql.includes('INSERT INTO "runtime_checkpoint_writes"'),
    )!;
    assert.equal(insert.parameters[4], -1);
    assert.equal(insert.parameters[6], "json");
  });

  it("replaces an existing negative-index write behind the active lease", async () => {
    const harness = storeHarness((sql) => {
      if (sql.includes('FROM "runtime_runs"') && sql.includes("FOR UPDATE")) {
        return [{ id: RUN_ID }];
      }
      if (sql.includes('FROM "runtime_checkpoints" AS checkpoint')) {
        return [checkpointRow()];
      }
      if (sql.includes("WITH RECURSIVE ancestors")) return [];
      if (sql.includes('FROM "runtime_checkpoint_writes"')) {
        return [checkpointWriteRow({ index: -3, value: { value: "old" } })];
      }
      if (sql.includes('UPDATE "runtime_checkpoint_writes"')) {
        return [{ id: WRITE_ID }];
      }
      return [];
    });

    const saved = await harness.run((lease) =>
      harness.store.savePendingWrites({
        checkpoint: {
          adapterCheckpointKey: CHECKPOINT_KEY,
          checkpointId: CHECKPOINT_ID,
          namespace: "",
          sequence: 1,
        },
        lease,
        writes: [
          {
            channel: "__interrupt__",
            index: -3,
            taskId: "task-1",
            type: "json",
            value: { value: "new" },
          },
        ],
      }),
    );

    assert.deepEqual(saved.writes, [
      {
        channel: "__interrupt__",
        index: -3,
        taskId: "task-1",
        type: "json",
        value: { value: "new" },
      },
    ]);
    const update = harness.calls.find((call) =>
      call.sql.includes('UPDATE "runtime_checkpoint_writes"'),
    )!;
    assert.match(update.sql, /"write_index" < 0/);
    assert.match(update.sql, /"channel" = \$6/);
    assert.deepEqual(update.parameters.slice(3, 8), [
      "task-1",
      -3,
      "__interrupt__",
      "json",
      JSON.stringify({ value: "new" }),
    ]);
    assert.equal(
      harness.calls.some((call) =>
        call.sql.includes('INSERT INTO "runtime_checkpoint_writes"'),
      ),
      false,
    );
  });

  it("keeps positive-index pending writes immutable", async () => {
    const harness = storeHarness((sql) => {
      if (sql.includes('FROM "runtime_runs"') && sql.includes("FOR UPDATE")) {
        return [{ id: RUN_ID }];
      }
      if (sql.includes('FROM "runtime_checkpoints" AS checkpoint')) {
        return [checkpointRow()];
      }
      if (sql.includes("WITH RECURSIVE ancestors")) return [];
      if (sql.includes('FROM "runtime_checkpoint_writes"')) {
        return [checkpointWriteRow({ index: 0, value: { value: "old" } })];
      }
      return [];
    });

    await assert.rejects(
      () =>
        harness.run((lease) =>
          harness.store.savePendingWrites({
            checkpoint: {
              adapterCheckpointKey: CHECKPOINT_KEY,
              checkpointId: CHECKPOINT_ID,
              namespace: "",
              sequence: 1,
            },
            lease,
            writes: [
              {
                channel: "__interrupt__",
                index: 0,
                taskId: "task-1",
                type: "json",
                value: { value: "new" },
              },
            ],
          }),
        ),
      (error) => hasCode(error, RUNTIME_CHECKPOINT_STORE_ERROR_CODES.conflict),
    );
    assert.equal(
      harness.calls.some((call) =>
        call.sql.includes('UPDATE "runtime_checkpoint_writes"'),
      ),
      false,
    );
  });

  it("returns the stable stale-lease error when trusted context is absent", async () => {
    const harness = storeHarness(() => assert.fail("query must not execute"));

    await assert.rejects(
      () =>
        harness.store.loadLatest({
          namespace: "",
          runId: RUN_ID,
          workspaceId: WORKSPACE_ID,
        }),
      (error) => hasCode(error, RUNTIME_CHECKPOINT_STORE_ERROR_CODES.staleLease),
    );
    assert.equal(harness.calls.length, 0);
  });

  it("rejects cross-workspace reads before querying PostgreSQL", async () => {
    const harness = storeHarness(() => assert.fail("query must not execute"));

    await assert.rejects(
      () =>
        harness.run(() =>
          harness.store.loadLatest({
            namespace: "",
            runId: RUN_ID,
            workspaceId: OTHER_WORKSPACE_ID,
          }),
        ),
      (error) => hasCode(error, RUNTIME_CHECKPOINT_STORE_ERROR_CODES.staleLease),
    );
    assert.equal(harness.calls.length, 0);
  });

  it("detects stored-state digest tampering on read", async () => {
    const harness = storeHarness((sql) => {
      if (sql.includes('FROM "runtime_checkpoints" AS checkpoint')) {
        return [checkpointRow({ digest: "0".repeat(64) })];
      }
      return [];
    });

    await assert.rejects(
      () =>
        harness.run(() =>
          harness.store.loadLatest({
            namespace: "",
            runId: RUN_ID,
            workspaceId: WORKSPACE_ID,
          }),
        ),
      (error) => hasCode(error, RUNTIME_CHECKPOINT_STORE_ERROR_CODES.invalid),
    );
  });
});

type QueryCall = { parameters: unknown[]; sql: string };

function storeHarness(
  resultFor: (sql: string, parameters: unknown[]) => unknown,
) {
  const calls: QueryCall[] = [];
  const trusted = new TrustedRunContextService();
  let transactions = 0;
  const manager = {
    query: async (sql: string, parameters: unknown[]) => {
      calls.push({ parameters, sql });
      return resultFor(sql, parameters);
    },
  };
  const dataSource = {
    query: manager.query,
    transaction: async (work: (value: typeof manager) => Promise<unknown>) => {
      transactions += 1;
      return work(manager);
    },
  };
  const store = new TypeOrmRuntimeCheckpointStore(dataSource as never, trusted);
  return {
    calls,
    get transactions() {
      return transactions;
    },
    store,
    run<T>(work: (lease: RunLease) => Promise<T>) {
      return trusted.run(
        claimedRun(),
        new AbortController().signal,
        (context) => work(context.lease),
      );
    },
  };
}

function checkpointRow(
  overrides: { digest?: string; state?: HermesJsonValue } = {},
) {
  const adapterState = {
    adapter: ADAPTER,
    state: overrides.state ?? STATE,
  };
  return {
    adapter_state: adapterState,
    checkpoint_id: CHECKPOINT_ID,
    checkpoint_key: CHECKPOINT_KEY,
    lease_generation: 2,
    namespace: "",
    parent_checkpoint_id: null,
    parent_checkpoint_key: null,
    run_id: RUN_ID,
    schema_version: RUNTIME_CHECKPOINT_SCHEMA_VERSION,
    sequence: 1,
    state_digest:
      overrides.digest ??
      createHash("sha256").update(canonicalJson(adapterState)).digest("hex"),
    workspace_id: WORKSPACE_ID,
  };
}

function checkpointWriteRow(
  overrides: { index?: number; value?: HermesJsonValue } = {},
) {
  return {
    channel: "__interrupt__",
    task_id: "task-1",
    type: "json",
    value: overrides.value ?? { value: "old" },
    write_index: overrides.index ?? -3,
  };
}

function claimedRun(): ClaimedRuntimeRun {
  return {
    attempt: 1,
    deadlineDelayMs: null,
    dispatchId: DISPATCH_ID,
    fencingGeneration: 2,
    leaseToken: LEASE_TOKEN,
    maxAttempts: 3,
    runId: RUN_ID,
    runKind: "agent.graph",
    workspaceId: WORKSPACE_ID,
  };
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function hasCode(error: unknown, code: string) {
  return error instanceof RuntimeCheckpointStoreError && error.code === code;
}

const ADAPTER: GraphExecutionAdapterDescriptor = Object.freeze({
  checkpointVersion: "langgraph.checkpoint/v4-jsonplus/v1",
  kind: "langgraph.state",
});
const STATE = Object.freeze({ value: 1 });
const WORKSPACE_ID = "018f80c0-0000-7000-8000-000000000001";
const OTHER_WORKSPACE_ID = "018f80c0-0000-7000-8000-000000000002";
const RUN_ID = "018f80c0-0000-7000-8000-000000000003";
const DISPATCH_ID = "018f80c0-0000-7000-8000-000000000004";
const LEASE_TOKEN = "018f80c0-0000-7000-8000-000000000005";
const CHECKPOINT_ID = "018f80c0-0000-7000-8000-000000000006";
const CHECKPOINT_KEY = "018f80c0-0000-7000-8000-000000000007";
const EVENT_ID = "018f80c0-0000-7000-8000-000000000008";
const WRITE_ID = "018f80c0-0000-7000-8000-000000000009";
