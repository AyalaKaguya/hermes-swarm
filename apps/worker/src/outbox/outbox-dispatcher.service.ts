import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { createRuntimeDispatchEnvelope } from "@hermes-swarm/agent-sdk";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";
import {
  OUTBOX_STORE,
  RUNTIME_QUEUE,
  type ClaimedOutboxMessage,
  type OutboxStore,
  type RuntimeQueue,
} from "./outbox.types.js";

const MAX_RETRY_BACKOFF_MS = 30_000;
const MIN_RETRY_BACKOFF_MS = 250;

@Injectable()
export class OutboxDispatcherService {
  private readonly logger = new Logger(OutboxDispatcherService.name);
  private loopPromise: Promise<void> | null = null;
  private running = false;
  private wake: (() => void) | null = null;

  constructor(
    @Inject(OUTBOX_STORE) private readonly store: OutboxStore,
    @Inject(RUNTIME_QUEUE) private readonly queue: RuntimeQueue,
    private readonly configService: ConfigService,
  ) {}

  start() {
    if (this.loopPromise) return;
    this.running = true;
    this.loopPromise = this.runLoop();
  }

  async stop() {
    this.running = false;
    this.wake?.();
    await this.loopPromise;
    this.loopPromise = null;
  }

  isRunning() {
    return this.running;
  }

  async dispatchOnce() {
    const config = this.workerConfig();
    const messages = await this.store.claimBatch({
      batchSize: config.outboxBatchSize,
      leaseMs: config.outboxLeaseMs,
      reconcileMs: config.outboxReconcileMs,
    });
    await Promise.all(messages.map((message) => this.publish(message)));
    return messages.length;
  }

  private async runLoop() {
    while (this.running) {
      try {
        const claimed = await this.dispatchOnce();
        if (claimed > 0) continue;
      } catch (error) {
        this.logger.warn(`Outbox dispatch cycle failed: ${safeError(error)}`);
      }
      await this.waitForNextPoll();
    }
  }

  private async publish(message: ClaimedOutboxMessage) {
    try {
      await this.queue.add(
        createRuntimeDispatchEnvelope({
          dispatchId: message.dispatchId,
          runId: message.runId,
        }),
      );
      const finalized = await this.store.markPublished(message);
      if (!finalized) {
        this.logger.warn(
          `Outbox publish fence changed before finalization (${message.dispatchId})`,
        );
      }
    } catch (error) {
      const backoffMs = retryBackoffMs(message.attempt);
      const released = await this.store.releaseForRetry(message, {
        errorCode: "RUNTIME_OUTBOX_PUBLISH_FAILED",
        retryBackoffMs: backoffMs,
      });
      this.logger.warn(
        `Outbox publish failed (${message.dispatchId}): ${safeError(error)}`,
      );
      if (!released) {
        this.logger.warn(
          `Outbox retry fence changed before release (${message.dispatchId})`,
        );
      }
    }
  }

  private async waitForNextPoll() {
    if (!this.running) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, this.workerConfig().outboxPollMs);
      this.wake = () => {
        clearTimeout(timeout);
        resolve();
      };
    });
    this.wake = null;
  }

  private workerConfig() {
    return this.configService.getOrThrow<WorkerRuntimeConfig>("worker");
  }
}

export function retryBackoffMs(attempt: number) {
  const exponent = Math.max(0, Math.min(8, attempt - 1));
  return Math.min(
    MAX_RETRY_BACKOFF_MS,
    MIN_RETRY_BACKOFF_MS * 2 ** exponent,
  );
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 480);
}
