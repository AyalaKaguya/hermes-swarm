import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkspaceJobFanoutService } from "./workspace-job-fanout.service.js";

describe("WorkspaceJobFanoutService", () => {
  it("converts platform discovery into one explicit task per active workspace", async () => {
    let findOptions: unknown;
    const service = new WorkspaceJobFanoutService({
      find: async (options: unknown) => {
        findOptions = options;
        return [{ id: "workspace-a" }, { id: "workspace-b" }];
      },
    } as any);
    const dispatched: any[] = [];

    const result = await service.fanOut({
      dispatch: async (job) => {
        dispatched.push(job);
        return job.workspaceId;
      },
      name: "tickets.archive-expired",
      payload: (workspaceId) => ({ workspaceId }),
      runId: "daily:2026-07-11",
    });

    assert.deepEqual(result, ["workspace-a", "workspace-b"]);
    assert.deepEqual(
      dispatched.map((job) => ({
        idempotencyKey: job.idempotencyKey,
        name: job.name,
        workspaceId: job.workspaceId,
      })),
      [
        {
          idempotencyKey: "daily:2026-07-11",
          name: "tickets.archive-expired",
          workspaceId: "workspace-a",
        },
        {
          idempotencyKey: "daily:2026-07-11",
          name: "tickets.archive-expired",
          workspaceId: "workspace-b",
        },
      ],
    );
    assert.deepEqual((findOptions as any).where.status, "active");
    assert.equal((findOptions as any).where.deletedAt._type, "isNull");
  });
});
