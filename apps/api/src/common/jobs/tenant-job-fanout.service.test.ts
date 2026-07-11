import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantJobFanoutService } from "./tenant-job-fanout.service.js";

describe("TenantJobFanoutService", () => {
  it("converts platform discovery into one explicit task per active tenant", async () => {
    let findOptions: unknown;
    const service = new TenantJobFanoutService({
      find: async (options: unknown) => {
        findOptions = options;
        return [{ id: "tenant-a" }, { id: "tenant-b" }];
      },
    } as any);
    const dispatched: any[] = [];

    const result = await service.fanOut({
      dispatch: async (job) => {
        dispatched.push(job);
        return job.tenantId;
      },
      name: "tickets.archive-expired",
      payload: (tenantId) => ({ tenantId }),
      runId: "daily:2026-07-11",
    });

    assert.deepEqual(result, ["tenant-a", "tenant-b"]);
    assert.deepEqual(
      dispatched.map((job) => ({
        idempotencyKey: job.idempotencyKey,
        name: job.name,
        tenantId: job.tenantId,
      })),
      [
        {
          idempotencyKey: "daily:2026-07-11",
          name: "tickets.archive-expired",
          tenantId: "tenant-a",
        },
        {
          idempotencyKey: "daily:2026-07-11",
          name: "tickets.archive-expired",
          tenantId: "tenant-b",
        },
      ],
    );
    assert.deepEqual((findOptions as any).where.status, "active");
    assert.equal((findOptions as any).where.deletedAt._type, "isNull");
  });
});
