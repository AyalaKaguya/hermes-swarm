import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createRuntimeDispatchEnvelope } from "@hermes-swarm/agent-sdk";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";
import {
  BullMqRuntimeQueueService,
  runtimeQueueJobOptions,
} from "./bullmq-runtime-queue.service.js";
import type { RuntimeJobProcessor } from "./runtime-job-processor.js";

describe("runtime queue options", () => {
  it("deduplicates delivery by the persisted dispatch id", () => {
    const envelope = createRuntimeDispatchEnvelope({
      dispatchId: "018f80c0-0000-7000-8000-000000000001",
      runId: "018f80c0-0000-7000-8000-000000000002",
    });

    const options = runtimeQueueJobOptions(envelope);
    assert.equal(options.jobId, envelope.dispatchId);
    assert.equal(options.attempts, 5);
    assert.deepEqual(options.backoff, { delay: 1_000, type: "exponential" });
    assert.equal(options.removeOnComplete, true);
    assert.equal(options.removeOnFail, true);
  });

  it("starts graceful close, then aborts and disconnects after its deadline", async () => {
    const previousExitCode = process.exitCode;
    const events: string[] = [];
    const service = new TestableRuntimeQueueService(30_000, {
      abortActive: () => events.push("abort"),
      process: async () => undefined,
    });
    const closeCalls: boolean[] = [];
    let disconnectCalls = 0;
    Object.assign(service as unknown as QueueInternals, {
      worker: {
        close: async (force = false) => {
          events.push("close");
          closeCalls.push(force);
          return new Promise<void>(() => undefined);
        },
        disconnect: async () => {
          events.push("disconnect");
          disconnectCalls += 1;
        },
      },
    });

    try {
      await service.drain(5);
      assert.deepEqual(closeCalls, [false]);
      assert.equal(disconnectCalls, 1);
      assert.deepEqual(events, ["close", "abort", "disconnect"]);
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("fails readiness and requests restart when the worker loop rejects", async () => {
    const previousExitCode = process.exitCode;
    const service = new TestableRuntimeQueueService();

    try {
      await service.observeRun(Promise.reject(new Error("worker loop failed")));
      assert.equal(await service.isReady(), false);
      assert.equal(service.restartRequests, 1);
      assert.equal(process.exitCode, 1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it("disconnects Redis when graceful quit exceeds the shutdown deadline", async () => {
    const service = new TestableRuntimeQueueService(5);
    const disconnectCalls: boolean[] = [];
    Object.assign(service as unknown as QueueInternals, {
      consumerConnection: {
        disconnect: (reconnect = true) => {
          disconnectCalls.push(reconnect);
        },
        quit: async () => new Promise<"OK">(() => undefined),
        status: "ready",
      },
    });

    await service.onApplicationShutdown();
    assert.deepEqual(disconnectCalls, [false]);
  });
});

type QueueInternals = {
  consumerConnection?: {
    disconnect(reconnect?: boolean): void;
    quit(): Promise<"OK">;
    status: string;
  };
  worker?: {
    close(force?: boolean): Promise<void>;
    disconnect(): Promise<void>;
  };
  workerRun?: Promise<void>;
};

class TestableRuntimeQueueService extends BullMqRuntimeQueueService {
  restartRequests = 0;

  constructor(
    shutdownGraceMs = 30_000,
    processor: RuntimeJobProcessor = {
      abortActive: () => undefined,
      process: async () => undefined,
    },
  ) {
    super(
      processor,
      {
        getOrThrow: () =>
          ({ shutdownGraceMs } satisfies Partial<WorkerRuntimeConfig>),
      } as never,
    );
  }

  observeRun(run: Promise<void>) {
    this.accepting = true;
    return this.superviseWorkerRun(run);
  }

  protected override requestProcessRestart() {
    this.restartRequests += 1;
  }
}
