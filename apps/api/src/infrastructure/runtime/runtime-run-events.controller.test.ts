import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import type { RunEvent } from "@hermes-swarm/api-contracts/ai";
import {
  RuntimeRunEventsController,
  resolveAfterSequence,
  toSseFrame,
} from "./runtime-run-events.controller.js";
import type { RuntimeRunEventsService } from "./runtime-run-events.service.js";

describe("RuntimeRunEventsController", () => {
  it("uses the furthest trusted resume cursor and rejects malformed headers", () => {
    assert.equal(resolveAfterSequence(3, "5"), 5);
    assert.equal(resolveAfterSequence(7, "5"), 7);
    assert.equal(resolveAfterSequence(undefined, undefined), 0);
    assert.throws(
      () => resolveAfterSequence(0, "1\n2"),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => resolveAfterSequence(0, "2147483648"),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it("serializes stable id, event, and JSON data fields", () => {
    const frame = toSseFrame(event(2));
    assert.match(frame, /^id: 2\nevent: run\.status\.changed\ndata: /);
    assert.ok(frame.endsWith("\n\n"));
    const data = JSON.parse(frame.split("data: ")[1]!.trim()) as RunEvent;
    assert.equal(data.sequence, 2);
  });

  it("writes replayed events and closes a terminal stream", async () => {
    const frames: string[] = [];
    const headers = new Map<string, string>();
    let ended = false;
    let openedAfter = -1;
    const service = {
      async openStream(
        _runId: string,
        afterSequence: number,
        _signal: AbortSignal,
      ) {
        openedAfter = afterSequence;
        return (async function* () {
          yield event(2);
          yield event(3, "running", "succeeded");
        })();
      },
    } as unknown as RuntimeRunEventsService;
    const controller = new RuntimeRunEventsController(service);
    const closeListeners = new Set<() => void>();
    const request = {
      off: (_name: "close", listener: () => void) =>
        closeListeners.delete(listener),
      on: (_name: "close", listener: () => void) => {
        closeListeners.add(listener);
      },
    };
    const response = {
      end: () => {
        ended = true;
      },
      flushHeaders: () => undefined,
      setHeader: (name: string, value: string) => headers.set(name, value),
      status: (_status: number) => response,
      writableEnded: false,
      write: (chunk: string) => {
        frames.push(chunk);
        return true;
      },
    };

    await controller.stream(
      "33333333-3333-4333-8333-333333333333",
      { afterSequence: 0 },
      "1",
      request,
      response,
    );

    assert.equal(openedAfter, 1);
    assert.deepEqual(
      frames.map((frame) => Number(frame.match(/^id: (\d+)/)?.[1])),
      [2, 3],
    );
    assert.equal(headers.get("Content-Type"), "text/event-stream; charset=utf-8");
    assert.equal(headers.get("X-Accel-Buffering"), "no");
    assert.equal(ended, true);
    assert.equal(closeListeners.size, 0);
  });
});

function event(
  sequence: number,
  from: "queued" | "running" = "queued",
  to: "running" | "succeeded" = "running",
): RunEvent {
  return {
    callId: null,
    eventKey: `run.status.changed:${sequence}`,
    id: `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`,
    nodeId: null,
    occurredAt: `2026-07-25T00:00:0${sequence}.000Z`,
    payload: { from, reasonCode: null, to },
    runId: "33333333-3333-4333-8333-333333333333",
    schemaVersion: "hermes.run-event/v1",
    sequence,
    type: "run.status.changed",
    workspaceId: "11111111-1111-4111-8111-111111111111",
  };
}
