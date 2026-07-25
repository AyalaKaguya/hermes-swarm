import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuntimeDispatchEnvelope } from "@hermes-swarm/agent-sdk";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";
import { OutboxDispatcherService, retryBackoffMs } from "./outbox-dispatcher.service.js";
import type {
  ClaimedOutboxMessage,
  OutboxStore,
  RuntimeQueue,
} from "./outbox.types.js";

const config: WorkerRuntimeConfig = {
  healthPort: 3_210,
  outboxBatchSize: 10,
  outboxLeaseMs: 30_000,
  outboxPollMs: 1_000,
  outboxReconcileMs: 60_000,
  postgresUrl: "postgresql://db/hermes",
  queueName: "runtime",
  queuePrefix: "hermes",
  redisUrl: "redis://cache",
  shutdownGraceMs: 5_000,
  workerConcurrency: 2,
};

describe("OutboxDispatcherService", () => {
  it("re-publishes a reconciled message with the stable dispatch id after Redis loss", async () => {
    const message = claimed();
    const store = new FakeOutboxStore([[message], [message]]);
    const queue = new DeduplicatingQueue();
    const dispatcher = createDispatcher(store, queue);

    await dispatcher.dispatchOnce();
    queue.uniqueDispatches.clear();
    await dispatcher.dispatchOnce();

    assert.equal(queue.addCalls.length, 2);
    assert.equal(queue.uniqueDispatches.size, 1);
    assert.equal(store.published.length, 2);
    assert.deepEqual(
      store.claims.map((claim) => claim.reconcileMs),
      [config.outboxReconcileMs, config.outboxReconcileMs],
    );
    assert.deepEqual(queue.addCalls[0], {
      dispatchId: message.dispatchId,
      runId: message.runId,
      schemaVersion: "hermes.runtime-dispatch/v1",
    });
  });

  it("finalizes and retries only through the claim fence", async () => {
    const message = claimed();
    const successful = new FakeOutboxStore([[message]]);
    await createDispatcher(successful, new DeduplicatingQueue()).dispatchOnce();
    assert.deepEqual(successful.published, [message]);

    const failed = new FakeOutboxStore([[message]]);
    const queue = new DeduplicatingQueue();
    queue.failure = new Error("redis unavailable");
    await createDispatcher(failed, queue).dispatchOnce();
    assert.equal(failed.retries.length, 1);
    assert.equal(failed.retries[0]?.message.leaseToken, message.leaseToken);
    assert.equal(
      failed.retries[0]?.input.errorCode,
      "RUNTIME_OUTBOX_PUBLISH_FAILED",
    );
    assert.equal(failed.retries[0]?.input.retryBackoffMs, 250);
  });

  it("bounds exponential retry backoff", () => {
    assert.equal(retryBackoffMs(1), 250);
    assert.equal(retryBackoffMs(2), 500);
    assert.equal(retryBackoffMs(99), 30_000);
  });
});

function createDispatcher(store: OutboxStore, queue: RuntimeQueue) {
  return new OutboxDispatcherService(store, queue, {
    getOrThrow: () => config,
  } as never);
}

function claimed(): ClaimedOutboxMessage {
  return {
    attempt: 1,
    dispatchId: "018f80c0-0000-7000-8000-000000000001",
    leaseToken: "018f80c0-0000-7000-8000-000000000002",
    runId: "018f80c0-0000-7000-8000-000000000003",
    workspaceId: "018f80c0-0000-7000-8000-000000000004",
  };
}

class FakeOutboxStore implements OutboxStore {
  readonly claims: Array<Parameters<OutboxStore["claimBatch"]>[0]> = [];
  readonly published: ClaimedOutboxMessage[] = [];
  readonly retries: Array<{
    input: { errorCode: string; retryBackoffMs: number };
    message: ClaimedOutboxMessage;
  }> = [];

  constructor(private readonly batches: ClaimedOutboxMessage[][]) {}

  async claimBatch(input: Parameters<OutboxStore["claimBatch"]>[0]) {
    this.claims.push(input);
    return this.batches.shift() ?? [];
  }

  async markPublished(message: ClaimedOutboxMessage) {
    this.published.push(message);
    return true;
  }

  async releaseForRetry(
    message: ClaimedOutboxMessage,
    input: { errorCode: string; retryBackoffMs: number },
  ) {
    this.retries.push({ input, message });
    return true;
  }
}

class DeduplicatingQueue implements RuntimeQueue {
  readonly addCalls: RuntimeDispatchEnvelope[] = [];
  readonly uniqueDispatches = new Set<string>();
  failure: Error | null = null;

  async add(envelope: RuntimeDispatchEnvelope) {
    this.addCalls.push(envelope);
    if (this.failure) throw this.failure;
    this.uniqueDispatches.add(envelope.dispatchId);
  }

  async isReady() {
    return true;
  }
}
