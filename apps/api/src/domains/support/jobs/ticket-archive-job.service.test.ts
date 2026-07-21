import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  TICKET_ARCHIVE_JOB,
  TicketArchiveJobService,
} from "./ticket-archive-job.service.js";

describe("TicketArchiveJobService", () => {
  it("archives tickets only through the workspace executor", async () => {
    const calls: string[] = [];
    const executor = {
      execute: async (job: any, handler: () => Promise<unknown>) => {
        calls.push(`execute:${job.workspaceId}`);
        return { result: await handler(), status: "completed" };
      },
    };
    const tickets = {
      archiveExpiredTickets: async (workspaceId: string) => {
        calls.push(`archive:${workspaceId}`);
        return { archived: 3 };
      },
    };
    const service = new TicketArchiveJobService(
      executor as any,
      {} as any,
      tickets as any,
    );

    const result = await service.execute({
      idempotencyKey: "run-1",
      name: TICKET_ARCHIVE_JOB,
      payload: { requestedAt: "2026-07-11T00:00:00.000Z" },
      workspaceId: "workspace-a",
    });

    assert.deepEqual(calls, ["execute:workspace-a", "archive:workspace-a"]);
    assert.deepEqual(result, {
      result: { archived: 3 },
      status: "completed",
    });
  });

  it("fans a platform run out into workspace job envelopes", async () => {
    let fanoutInput: any;
    const service = new TicketArchiveJobService(
      { execute: async () => ({ status: "completed" }) } as any,
      {
        fanOut: async (input: any) => {
          fanoutInput = input;
          return [];
        },
      } as any,
      {} as any,
    );
    await service.runForAllActiveWorkspaces(
      "daily:2026-07-11",
      "2026-07-11T00:00:00.000Z",
    );
    assert.equal(fanoutInput.name, TICKET_ARCHIVE_JOB);
    assert.equal(fanoutInput.runId, "daily:2026-07-11");
    assert.deepEqual(fanoutInput.payload("workspace-a"), {
      requestedAt: "2026-07-11T00:00:00.000Z",
    });
  });
});
