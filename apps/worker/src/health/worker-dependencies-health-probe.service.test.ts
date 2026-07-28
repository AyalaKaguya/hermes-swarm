import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkerDependenciesHealthProbeService } from "./worker-dependencies-health-probe.service.js";

describe("WorkerDependenciesHealthProbeService", () => {
  it("requires both PostgreSQL and the runtime queue", async () => {
    let databaseChecks = 0;
    const probe = new WorkerDependenciesHealthProbeService(
      {
        query: async () => {
          databaseChecks += 1;
          return [{ connected: true }];
        },
      } as never,
      { add: async () => undefined, isReady: async () => true },
    );

    await probe.check();
    assert.equal(databaseChecks, 1);
  });

  it("fails readiness when BullMQ is unavailable", async () => {
    const probe = new WorkerDependenciesHealthProbeService(
      { query: async () => [{ connected: true }] } as never,
      { add: async () => undefined, isReady: async () => false },
    );

    await assert.rejects(() => probe.check(), /queue is unavailable/i);
  });
});
