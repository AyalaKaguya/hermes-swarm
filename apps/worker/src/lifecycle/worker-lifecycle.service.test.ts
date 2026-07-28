import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";
import { WorkerHealthService } from "../health/worker-health.service.js";
import { WorkerLifecycleService } from "./worker-lifecycle.service.js";
import type { WorkerConsumerControl } from "./worker-lifecycle.types.js";

describe("WorkerLifecycleService", () => {
  it("turns readiness off before pausing intake and draining", async () => {
    const events: string[] = [];
    const health = new WorkerHealthService({ check: async () => undefined });
    const consumer: WorkerConsumerControl = {
      drain: async () => {
        events.push("drain");
      },
      isReady: async () => true,
      pause: async () => {
        events.push((await health.ready()).status === "error" ? "pause-not-ready" : "pause-ready");
      },
      start: async () => {
        events.push("start");
      },
    };
    const dispatcher = {
      start: () => events.push("dispatch-start"),
      stop: async () => {
        events.push("dispatch-stop");
      },
    };
    const lifecycle = new WorkerLifecycleService(
      consumer,
      dispatcher as never,
      health,
      configService(),
    );

    await lifecycle.onApplicationBootstrap();
    assert.deepEqual(await health.ready(), { status: "ok" });
    await lifecycle.beforeApplicationShutdown("SIGTERM");

    assert.deepEqual(events, [
      "start",
      "dispatch-start",
      "pause-not-ready",
      "dispatch-stop",
      "drain",
    ]);
    assert.deepEqual(await health.ready(), {
      reason: "draining",
      status: "error",
    });
  });

  it("coalesces repeated shutdown hooks", async () => {
    let drains = 0;
    const lifecycle = new WorkerLifecycleService(
      {
        drain: async () => {
          drains += 1;
        },
        isReady: async () => true,
        pause: async () => undefined,
        start: async () => undefined,
      },
      { start: () => undefined, stop: async () => undefined } as never,
      new WorkerHealthService({ check: async () => undefined }),
      configService(),
    );

    await Promise.all([
      lifecycle.beforeApplicationShutdown("SIGTERM"),
      lifecycle.beforeApplicationShutdown("SIGINT"),
    ]);
    assert.equal(drains, 1);
  });

  it("uses one grace deadline for dispatcher stop and consumer drain", async () => {
    const previousExitCode = process.exitCode;
    let drainTimeoutMs: number | undefined;
    const lifecycle = new WorkerLifecycleService(
      {
        drain: async (timeoutMs) => {
          drainTimeoutMs = timeoutMs;
        },
        isReady: async () => true,
        pause: async () => undefined,
        start: async () => undefined,
      },
      {
        start: () => undefined,
        stop: async () => new Promise<void>(() => undefined),
      } as never,
      new WorkerHealthService({ check: async () => undefined }),
      configService(10),
    );

    try {
      await lifecycle.beforeApplicationShutdown("SIGTERM");
      assert.equal(drainTimeoutMs, 0);
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });
});

function configService(shutdownGraceMs = 500) {
  return {
    getOrThrow: () =>
      ({ shutdownGraceMs } satisfies Partial<WorkerRuntimeConfig>),
  } as never;
}
