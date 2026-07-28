import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EntityManager } from "typeorm";
import {
  appendRuntimeRunStatusChanges,
  RuntimeRunStatusChangeInvariantError,
  RuntimeRunStatusChangeValidationError,
  type RuntimeRunStatusChange,
} from "./append-runtime-run-status-changes.js";
import type { RuntimeRunStatus } from "./entities/runtime-run.entity.js";

const WORKSPACE_ID = "11111111-1111-4111-8111-111111111111";
const RUN_A = "22222222-2222-4222-8222-222222222222";
const RUN_B = "33333333-3333-4333-8333-333333333333";
const DATABASE_NOW = new Date("2026-07-25T12:00:00.000Z");

describe("appendRuntimeRunStatusChanges", () => {
  it("requires the caller's active transaction even for an empty batch", async () => {
    const state = createState({ transactionActive: false });

    await assert.rejects(
      () => appendRuntimeRunStatusChanges(state.manager, []),
      RuntimeRunStatusChangeValidationError,
    );
    assert.equal(state.calls.length, 0);
  });

  it("ignores no-op changes without allocating a sequence", async () => {
    const state = createState();

    const events = await appendRuntimeRunStatusChanges(state.manager, [
      change(RUN_A, "queued", "queued"),
    ]);

    assert.deepEqual(events, []);
    assert.equal(state.calls.length, 0);
  });

  it("appends a batch sequentially with database-owned envelopes", async () => {
    const state = createState({
      currentStatuses: new Map([
        [key(WORKSPACE_ID, RUN_A), "running"],
        [key(WORKSPACE_ID, RUN_B), "cancelled"],
      ]),
    });

    const events = await appendRuntimeRunStatusChanges(state.manager, [
      change(RUN_A, "queued", "running", "dispatch.claimed"),
      change(RUN_B, "waiting", "cancelled", "user.cancelled"),
    ]);

    assert.equal(state.maximumConcurrentQueries, 1);
    assert.deepEqual(
      state.calls.map(({ parameters }) => parameters.slice(0, 5)),
      [
        [WORKSPACE_ID, RUN_A, "queued", "running", "dispatch.claimed"],
        [WORKSPACE_ID, RUN_B, "waiting", "cancelled", "user.cancelled"],
      ],
    );
    for (const { sql } of state.calls) {
      assert.match(sql, /UPDATE "runtime_runs" AS runtime_run/);
      assert.match(sql, /"event_sequence" \+ 1/);
      assert.match(sql, /runtime_run\."workspace_id" = \$1/);
      assert.match(sql, /runtime_run\."id" = \$2/);
      assert.match(sql, /runtime_run\."status" = \$4/);
      assert.match(sql, /INSERT INTO "runtime_run_events"/);
    }
    assert.deepEqual(
      events.map((event) => ({
        callId: event.callId,
        eventKey: event.eventKey,
        nodeId: event.nodeId,
        payload: event.payload,
        runId: event.runId,
        schemaVersion: event.schemaVersion,
        sequence: event.sequence,
        type: event.type,
        workspaceId: event.workspaceId,
      })),
      [
        {
          callId: null,
          eventKey: "run.status.changed:1",
          nodeId: null,
          payload: {
            from: "queued",
            reasonCode: "dispatch.claimed",
            to: "running",
          },
          runId: RUN_A,
          schemaVersion: "hermes.run-event/v1",
          sequence: 1,
          type: "run.status.changed",
          workspaceId: WORKSPACE_ID,
        },
        {
          callId: null,
          eventKey: "run.status.changed:1",
          nodeId: null,
          payload: {
            from: "waiting",
            reasonCode: "user.cancelled",
            to: "cancelled",
          },
          runId: RUN_B,
          schemaVersion: "hermes.run-event/v1",
          sequence: 1,
          type: "run.status.changed",
          workspaceId: WORKSPACE_ID,
        },
      ],
    );
    assert.deepEqual(events.map(({ occurredAt }) => occurredAt), [
      DATABASE_NOW,
      DATABASE_NOW,
    ]);
  });

  it("allocates monotonically when the same Run is appended again", async () => {
    const statuses = new Map([[key(WORKSPACE_ID, RUN_A), "running"]]);
    const state = createState({ currentStatuses: statuses });

    const first = await appendRuntimeRunStatusChanges(state.manager, [
      change(RUN_A, "queued", "running"),
    ]);
    statuses.set(key(WORKSPACE_ID, RUN_A), "cancelling");
    const second = await appendRuntimeRunStatusChanges(state.manager, [
      change(RUN_A, "running", "cancelling", "user.cancelled"),
    ]);

    assert.equal(first[0]?.sequence, 1);
    assert.equal(second[0]?.sequence, 2);
    assert.equal(second[0]?.eventKey, "run.status.changed:2");
  });

  it("fails closed when workspace, Run, or current to status does not match", async () => {
    const state = createState({
      currentStatuses: new Map([[key(WORKSPACE_ID, RUN_A), "queued"]]),
    });

    await assert.rejects(
      () =>
        appendRuntimeRunStatusChanges(state.manager, [
          change(RUN_A, "queued", "running"),
        ]),
      RuntimeRunStatusChangeInvariantError,
    );
    assert.equal(state.sequenceByRun.size, 0);
  });

  it("validates the full batch before writing its first event", async () => {
    const state = createState({
      currentStatuses: new Map([[key(WORKSPACE_ID, RUN_A), "running"]]),
    });
    const invalid = {
      ...change(RUN_B, "queued", "running"),
      reasonCode: "contains whitespace",
    };

    await assert.rejects(
      () =>
        appendRuntimeRunStatusChanges(state.manager, [
          change(RUN_A, "queued", "running"),
          invalid,
        ]),
      RuntimeRunStatusChangeValidationError,
    );
    assert.equal(state.calls.length, 0);
  });
});

function change(
  runId: string,
  from: RuntimeRunStatus,
  to: RuntimeRunStatus,
  reasonCode: string | null = null,
): RuntimeRunStatusChange {
  return { from, reasonCode, runId, to, workspaceId: WORKSPACE_ID };
}

function key(workspaceId: string, runId: string) {
  return `${workspaceId}:${runId}`;
}

function createState(
  options: {
    currentStatuses?: Map<string, RuntimeRunStatus>;
    transactionActive?: boolean;
  } = {},
) {
  const calls: Array<{ parameters: unknown[]; sql: string }> = [];
  const currentStatuses = options.currentStatuses ?? new Map();
  const sequenceByRun = new Map<string, number>();
  let concurrentQueries = 0;
  let maximumConcurrentQueries = 0;
  const state = {
    calls,
    currentStatuses,
    manager: undefined as unknown as EntityManager,
    get maximumConcurrentQueries() {
      return maximumConcurrentQueries;
    },
    sequenceByRun,
  };
  state.manager = {
    queryRunner: { isTransactionActive: options.transactionActive ?? true },
    async query(sql: string, parameters: unknown[]) {
      calls.push({ parameters, sql });
      concurrentQueries += 1;
      maximumConcurrentQueries = Math.max(
        maximumConcurrentQueries,
        concurrentQueries,
      );
      await Promise.resolve();
      concurrentQueries -= 1;

      const [workspaceId, runId, from, to, reasonCode, schemaVersion, type] =
        parameters as [string, string, string, string, string | null, string, string];
      const runKey = key(workspaceId, runId);
      if (currentStatuses.get(runKey) !== to) return [];
      const sequence = (sequenceByRun.get(runKey) ?? 0) + 1;
      sequenceByRun.set(runKey, sequence);
      const eventKey = `${type}:${sequence}`;
      return [
        {
          callId: null,
          createdAt: new Date(DATABASE_NOW),
          eventKey,
          id: eventId(sequence, runId === RUN_A ? "a" : "b"),
          nodeId: null,
          occurredAt: new Date(DATABASE_NOW),
          payload: { from, reasonCode, to },
          runId,
          schemaVersion,
          sequence,
          type,
          updatedAt: new Date(DATABASE_NOW),
          workspaceId,
        },
      ];
    },
  } as unknown as EntityManager;
  return state;
}

function eventId(sequence: number, prefix: string) {
  return `${prefix.repeat(8)}-${prefix.repeat(4)}-4${prefix.repeat(3)}-8${prefix.repeat(3)}-${sequence.toString().padStart(12, "0")}`;
}
