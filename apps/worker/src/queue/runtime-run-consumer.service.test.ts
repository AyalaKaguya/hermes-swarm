import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES,
  RuntimeRunHandlerRegistry,
  createRuntimeDispatchEnvelope,
  type RunHandler,
  type RunOutcome,
} from "@hermes-swarm/agent-sdk";
import {
  type ClaimedRuntimeRun,
  type RuntimeHeartbeatResult,
  type RuntimeRunClaimResult,
  type RuntimeRunRequeueResult,
  type RuntimeRunStore,
  type RuntimeStaleDeliveryRecoveryResult,
} from "../runtime/runtime-run.types.js";
import { TrustedRunContextService } from "../runtime/trusted-run-context.service.js";
import {
  RUNTIME_RUN_HEARTBEAT_MS,
  runtimeDeadlineTimerDelayMs,
  RuntimeRunConsumerService,
  RuntimeRunRetryError,
} from "./runtime-run-consumer.service.js";

describe("RuntimeRunConsumerService", () => {
  it("uses only the persisted claim to build the handler context", async () => {
    const store = new FakeRuntimeRunStore();
    const trusted = new TrustedRunContextService();
    let observedWorkspaceId: string | undefined;
    const handler = runHandler(async (context) => {
      observedWorkspaceId = trusted.current()?.lease.workspaceId;
      assert.equal(context.lease.workspaceId, claimedRun().workspaceId);
      return { status: "succeeded" };
    });
    const consumer = createConsumer(store, [handler], trusted);

    await consumer.process(envelope());

    assert.equal(observedWorkspaceId, claimedRun().workspaceId);
    assert.equal(store.finishes.length, 1);
    assert.equal(store.finishes[0]?.outcome.status, "succeeded");
  });

  it("rejects queue fields outside the exact dispatch envelope", async () => {
    const store = new FakeRuntimeRunStore();
    const consumer = createConsumer(store, []);

    await assert.rejects(() =>
      consumer.process({
        ...envelope(),
        workspaceId: "018f80c0-0000-7000-8000-000000000099",
      }),
    );
    assert.equal(store.claimCalls, 0);
  });

  it("permanently fails an unknown persisted run kind", async () => {
    const store = new FakeRuntimeRunStore();
    const consumer = createConsumer(store, []);

    await consumer.process(envelope());

    const outcome = store.finishes[0]?.outcome;
    assert.equal(outcome?.status, "failed");
    if (outcome?.status !== "failed") assert.fail("expected failed outcome");
    assert.equal(
      outcome.failure.code,
      RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES.unknownKind,
    );
    assert.equal(outcome.failure.retryable, false);
  });

  it("uses BullMQ retry before the final queue delivery", async () => {
    const store = new FakeRuntimeRunStore();
    const consumer = createConsumer(store, [
      runHandler(async () => ({
        failure: {
          code: "MODEL_TEMPORARILY_UNAVAILABLE",
          message: "temporary",
          retryable: true,
        },
        status: "failed",
      })),
    ]);

    await assert.rejects(
      () => consumer.process(envelope(), { attempt: 2, maxAttempts: 5 }),
      RuntimeRunRetryError,
    );
    assert.equal(store.requeues.length, 1);
    assert.equal(store.requeues[0]?.rearmOutbox, false);
    assert.equal(store.requeues[0]?.retryBackoffMs, 1_000);
  });

  it("rearms the durable outbox after a retryable final delivery", async () => {
    const store = new FakeRuntimeRunStore();
    const consumer = createConsumer(store, [
      runHandler(async () => {
        throw Object.assign(new Error("transient handler crash"), {
          code: "MODEL_TEMPORARILY_UNAVAILABLE",
          retryable: true,
        });
      }),
    ]);

    await consumer.process(envelope(), { attempt: 5, maxAttempts: 5 });

    assert.equal(store.requeues.length, 1);
    assert.equal(store.requeues[0]?.rearmOutbox, true);
    assert.equal(store.requeues[0]?.retryBackoffMs, 1_000);
    assert.equal(
      store.requeues[0]?.errorCode,
      "MODEL_TEMPORARILY_UNAVAILABLE",
    );
  });

  it("does not retry an unclassified handler exception", async () => {
    const store = new FakeRuntimeRunStore();
    const consumer = createConsumer(store, [
      runHandler(async () => {
        throw new Error("side effect outcome unknown");
      }),
    ]);

    await consumer.process(envelope(), { attempt: 1, maxAttempts: 5 });

    assert.equal(store.requeues.length, 0);
    const outcome = store.finishes[0]?.outcome;
    assert.equal(outcome?.status, "failed");
    if (outcome?.status !== "failed") assert.fail("expected failed outcome");
    assert.equal(
      outcome.failure.code,
      "RUNTIME_RUN_HANDLER_EXECUTION_FAILED",
    );
    assert.equal(outcome.failure.retryable, false);
  });

  it("aborts a blocking active handler when shutdown exceeds its deadline", async () => {
    const store = new FakeRuntimeRunStore();
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      notifyStarted = resolve;
    });
    let observedReason: unknown;
    const consumer = createConsumer(store, [
      runHandler(
        async (context) =>
          new Promise<RunOutcome>((resolve) => {
            context.signal.addEventListener(
              "abort",
              () => {
                observedReason = context.signal.reason;
                resolve({ status: "cancelled" });
              },
              { once: true },
            );
            notifyStarted();
          }),
      ),
    ]);

    const processing = consumer.process(envelope());
    await started;
    consumer.abortActive();
    await processing;

    assert.ok(observedReason instanceof Error);
    assert.equal(
      observedReason.message,
      "Runtime worker shutdown deadline exceeded.",
    );
    assert.equal(store.finishes[0]?.outcome.status, "cancelled");
  });

  it("durably recovers when completion loses its lease fence", async () => {
    const store = new FakeRuntimeRunStore();
    store.finishResult = false;
    const consumer = createConsumer(store, [
      runHandler(async () => ({ status: "succeeded" })),
    ]);

    await consumer.process(envelope());

    assert.equal(store.recoveries.length, 1);
    assert.deepEqual(store.recoveries[0], claimedRun());
  });

  it("durably recovers a stale retry requeue", async () => {
    const store = new FakeRuntimeRunStore();
    store.requeueResult = "stale";
    const consumer = createConsumer(store, [
      runHandler(async () => ({
        failure: {
          code: "MODEL_TEMPORARILY_UNAVAILABLE",
          message: "temporary",
          retryable: true,
        },
        status: "failed",
      })),
    ]);

    await consumer.process(envelope(), { attempt: 2, maxAttempts: 5 });

    assert.equal(store.recoveries.length, 1);
  });

  it(
    "durably recovers a stale heartbeat before acknowledging delivery",
    async (t) => {
      t.mock.timers.enable({ apis: ["setTimeout"] });
      const store = new FakeRuntimeRunStore();
      store.heartbeatResult = "stale";
      let notifyStarted!: () => void;
      const started = new Promise<void>((resolve) => {
        notifyStarted = resolve;
      });
      const consumer = createConsumer(store, [
        runHandler(
          async (context) =>
            new Promise<RunOutcome>((resolve) => {
              context.signal.addEventListener(
                "abort",
                () => resolve({ status: "cancelled" }),
                { once: true },
              );
              notifyStarted();
            }),
        ),
      ]);

      const processing = consumer.process(envelope());
      await started;
      t.mock.timers.tick(RUNTIME_RUN_HEARTBEAT_MS);
      await processing;

      assert.equal(store.recoveries.length, 1);
      assert.equal(store.finishes.length, 0);
    },
  );

  it("propagates stale delivery recovery failures to the queue", async () => {
    const store = new FakeRuntimeRunStore();
    store.finishResult = false;
    store.recoveryError = new Error("database unavailable");
    const consumer = createConsumer(store, [
      runHandler(async () => ({ status: "succeeded" })),
    ]);

    await assert.rejects(
      () => consumer.process(envelope()),
      /database unavailable/,
    );
  });

  it("does not clamp a far-future deadline to Node's timer ceiling", () => {
    assert.equal(
      runtimeDeadlineTimerDelayMs(30 * 24 * 60 * 60 * 1_000),
      null,
    );
    assert.equal(runtimeDeadlineTimerDelayMs(5_000), 5_000);
    assert.equal(runtimeDeadlineTimerDelayMs(-1), 0);
  });
});

function createConsumer(
  store: RuntimeRunStore,
  handlers: RunHandler[],
  trusted = new TrustedRunContextService(),
) {
  return new RuntimeRunConsumerService(
    store,
    new RuntimeRunHandlerRegistry(handlers),
    trusted,
  );
}

function runHandler(
  execute: RunHandler<"agent.graph">["execute"],
): RunHandler<"agent.graph"> {
  return { execute, kind: "agent.graph" };
}

function envelope() {
  const run = claimedRun();
  return createRuntimeDispatchEnvelope({
    dispatchId: run.dispatchId,
    runId: run.runId,
  });
}

function claimedRun(): ClaimedRuntimeRun {
  return {
    attempt: 1,
    deadlineDelayMs: null,
    dispatchId: "018f80c0-0000-7000-8000-000000000001",
    fencingGeneration: 3,
    leaseToken: "018f80c0-0000-7000-8000-000000000002",
    maxAttempts: 10,
    runId: "018f80c0-0000-7000-8000-000000000003",
    runKind: "agent.graph",
    workspaceId: "018f80c0-0000-7000-8000-000000000004",
  };
}

class FakeRuntimeRunStore implements RuntimeRunStore {
  claimCalls = 0;
  claimResult: RuntimeRunClaimResult = {
    kind: "claimed",
    run: claimedRun(),
  };
  readonly finishes: Array<{ outcome: RunOutcome }> = [];
  finishResult = true;
  heartbeatResult: RuntimeHeartbeatResult = "active";
  readonly recoveries: ClaimedRuntimeRun[] = [];
  recoveryError: Error | null = null;
  recoveryResult: RuntimeStaleDeliveryRecoveryResult = "rearmed";
  readonly requeues: Array<{
    errorCode: string;
    rearmOutbox: boolean;
    retryBackoffMs: number;
  }> = [];
  requeueResult: RuntimeRunRequeueResult = "requeued";

  async claim() {
    this.claimCalls += 1;
    return this.claimResult;
  }

  async finish(_run: ClaimedRuntimeRun, outcome: RunOutcome) {
    this.finishes.push({ outcome });
    return this.finishResult;
  }

  async heartbeat() {
    return this.heartbeatResult;
  }

  async recoverStaleDelivery(run: ClaimedRuntimeRun) {
    this.recoveries.push(run);
    if (this.recoveryError) throw this.recoveryError;
    return this.recoveryResult;
  }

  async requeue(
    _run: ClaimedRuntimeRun,
    input: {
      errorCode: string;
      rearmOutbox: boolean;
      retryBackoffMs: number;
    },
  ) {
    this.requeues.push({
      errorCode: input.errorCode,
      rearmOutbox: input.rearmOutbox,
      retryBackoffMs: input.retryBackoffMs,
    });
    return this.requeueResult;
  }
}
