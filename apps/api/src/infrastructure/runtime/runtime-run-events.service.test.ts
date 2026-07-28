import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import type { RunStatus } from "@hermes-swarm/api-contracts/ai";
import {
  RUNTIME_RUN_EVENT_SCHEMA_VERSION,
  RuntimeRun,
  RuntimeRunEvent,
} from "@hermes-swarm/core";
import type { Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { RuntimeRunEventsService } from "./runtime-run-events.service.js";

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const RUN_ID = "33333333-3333-4333-8333-333333333333";

describe("RuntimeRunEventsService", () => {
  it("returns an ordered, bounded page using explicit Workspace and Run filters", async () => {
    const runCalls: unknown[] = [];
    const eventCalls: unknown[] = [];
    const service = createService({
      eventFind: async (options) => {
        eventCalls.push(options);
        return [
          eventRow(1, "queued", "running"),
          eventRow(2, "running", "queued"),
          eventRow(3, "queued", "running"),
        ];
      },
      runFindOne: async (options) => {
        runCalls.push(options);
        return runSnapshot("running", 3);
      },
    });

    const page = await inWorkspace(service.context, WORKSPACE_A, () =>
      service.instance.list(RUN_ID, { afterSequence: 0, limit: 2 }),
    );

    assert.deepEqual(page.items.map((event) => event.sequence), [1, 2]);
    assert.equal(page.eventSequence, 3);
    assert.equal(page.hasMore, true);
    assert.equal(page.nextAfterSequence, 2);
    assert.equal(page.runStatus, "running");
    assert.equal(runCalls.length, 1);
    assert.deepEqual(
      (runCalls[0] as { where: unknown }).where,
      { id: RUN_ID, workspaceId: WORKSPACE_A },
    );
    assert.equal(eventCalls.length, 1);
    const eventOptions = eventCalls[0] as {
      order: unknown;
      take: number;
      where: { runId: string; workspaceId: string };
    };
    assert.equal(eventOptions.take, 3);
    assert.deepEqual(eventOptions.order, { sequence: "ASC" });
    assert.equal(eventOptions.where.runId, RUN_ID);
    assert.equal(eventOptions.where.workspaceId, WORKSPACE_A);
  });

  it("replays only the remaining terminal backlog and then closes", async () => {
    const service = createService({
      eventFind: async () => [eventRow(2, "running", "succeeded")],
      runFindOne: async () => runSnapshot("succeeded", 2),
    });
    const abortController = new AbortController();

    const stream = await inWorkspace(service.context, WORKSPACE_A, () =>
      service.instance.openStream(RUN_ID, 1, abortController.signal),
    );
    const received = [];
    for await (const event of stream) received.push(event);

    assert.deepEqual(received.map((event) => event.sequence), [2]);
    assert.equal(received[0]?.type, "run.status.changed");
  });

  it("fails closed for an unknown or cross-Workspace Run", async () => {
    const calls: unknown[] = [];
    const service = createService({
      eventFind: async () => [],
      runFindOne: async (options) => {
        calls.push(options);
        return null;
      },
    });

    await assert.rejects(
      () =>
        inWorkspace(service.context, WORKSPACE_B, () =>
          service.instance.list(RUN_ID, { afterSequence: 0, limit: 50 }),
        ),
      (error: unknown) => error instanceof NotFoundException,
    );
    assert.deepEqual(
      (calls[0] as { where: unknown }).where,
      { id: RUN_ID, workspaceId: WORKSPACE_B },
    );
  });

  it("rejects a resume cursor ahead of durable Run state", async () => {
    const service = createService({
      eventFind: async () => [],
      runFindOne: async () => runSnapshot("running", 2),
    });

    await assert.rejects(
      () =>
        inWorkspace(service.context, WORKSPACE_A, () =>
          service.instance.openStream(
            RUN_ID,
            3,
            new AbortController().signal,
          ),
        ),
      (error: unknown) => error instanceof BadRequestException,
    );

    await assert.rejects(
      () =>
        inWorkspace(service.context, WORKSPACE_A, () =>
          service.instance.list(RUN_ID, {
            afterSequence: 3,
            limit: 50,
          }),
        ),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});

function createService(input: {
  eventFind: (options: unknown) => Promise<RuntimeRunEvent[]>;
  runFindOne: (options: unknown) => Promise<RuntimeRun | null>;
}) {
  const context = new WorkspaceContextService();
  return {
    context,
    instance: new RuntimeRunEventsService(
      { findOne: input.runFindOne } as unknown as Repository<RuntimeRun>,
      { find: input.eventFind } as unknown as Repository<RuntimeRunEvent>,
      context,
    ),
  };
}

function runSnapshot(status: RunStatus, eventSequence: number) {
  return Object.assign(new RuntimeRun(), { eventSequence, status });
}

function eventRow(sequence: number, from: RunStatus, to: RunStatus) {
  return Object.assign(new RuntimeRunEvent(), {
    callId: null,
    eventKey: `run.status.changed:${sequence}`,
    id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    nodeId: null,
    occurredAt: new Date(`2026-07-25T00:00:0${sequence}.000Z`),
    payload: { from, reasonCode: null, to },
    runId: RUN_ID,
    schemaVersion: RUNTIME_RUN_EVENT_SCHEMA_VERSION,
    sequence,
    type: "run.status.changed",
    workspaceId: WORKSPACE_A,
  });
}

function inWorkspace<T>(
  context: WorkspaceContextService,
  workspaceId: string,
  work: () => T,
) {
  return context.run({ scopeLevel: "workspace", workspaceId }, work);
}
