import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RuntimeDispatchEnvelope } from "@hermes-swarm/agent-sdk";
import { RUNTIME_DISPATCH_TOPIC } from "@hermes-swarm/core";
import { Queue, Worker, type JobsOptions } from "bullmq";
import { Redis } from "ioredis";
import { performance } from "node:perf_hooks";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";
import type { WorkerConsumerControl } from "../lifecycle/worker-lifecycle.types.js";
import type { RuntimeQueue } from "../outbox/outbox.types.js";
import {
  RUNTIME_JOB_PROCESSOR,
  type RuntimeJobProcessor,
} from "./runtime-job-processor.js";

const QUEUE_RETRY_ATTEMPTS = 5;
const QUEUE_RETRY_DELAY_MS = 1_000;

@Injectable()
export class BullMqRuntimeQueueService
  implements RuntimeQueue, WorkerConsumerControl, OnApplicationShutdown
{
  private readonly logger = new Logger(BullMqRuntimeQueueService.name);
  private consumerConnection: Redis | null = null;
  private publisherConnection: Redis | null = null;
  private queue: Queue<RuntimeDispatchEnvelope> | null = null;
  private worker: Worker<RuntimeDispatchEnvelope> | null = null;
  private workerClose: Promise<void> | null = null;
  private workerRun: Promise<void> | null = null;
  private shutdownDeadlineAt: number | null = null;
  protected accepting = false;

  constructor(
    @Inject(RUNTIME_JOB_PROCESSOR)
    private readonly processor: RuntimeJobProcessor,
    private readonly configService: ConfigService,
  ) {}

  async start() {
    if (this.worker) return;
    const config = this.workerConfig();
    const connections = await this.createConnections(config.redisUrl);
    this.publisherConnection = connections.publisher;
    this.consumerConnection = connections.consumer;
    this.queue = new Queue<RuntimeDispatchEnvelope>(config.queueName, {
      connection: connections.publisher,
      prefix: config.queuePrefix,
    });
    const worker = new Worker<RuntimeDispatchEnvelope>(
      config.queueName,
      async (job) =>
        this.processor.process(job.data, {
          attempt: job.attemptsMade + 1,
          maxAttempts: readQueueAttempts(job.opts.attempts),
        }),
      {
        autorun: false,
        concurrency: config.workerConcurrency,
        connection: connections.consumer,
        prefix: config.queuePrefix,
      },
    );
    worker.on("error", (error) => {
      this.logger.error(`Runtime queue worker error: ${safeMessage(error)}`);
    });
    this.worker = worker;
    this.accepting = true;
    this.workerRun = this.superviseWorkerRun(worker.run());
    await Promise.all([connections.publisher.ping(), connections.consumer.ping()]);
  }

  async add(envelope: RuntimeDispatchEnvelope) {
    const queue = this.queue;
    if (!queue) throw new Error("Runtime queue is not started");
    await queue.add(RUNTIME_DISPATCH_TOPIC, envelope, runtimeQueueJobOptions(envelope));
  }

  async pause() {
    this.accepting = false;
    if (this.worker) await this.worker.pause(true);
  }

  async drain(timeoutMs: number) {
    const worker = this.worker;
    if (!worker) return;
    const deadlineAt = performance.now() + Math.max(0, timeoutMs);
    this.shutdownDeadlineAt = deadlineAt;
    const close = (this.workerClose ??= worker.close(false));
    const closed = await completesBefore(close, deadlineAt);
    if (!closed) {
      process.exitCode = 1;
      this.logger.warn(
        "Worker drain deadline exceeded; disconnecting the runtime queue",
      );
      this.processor.abortActive();
      const disconnect = worker.disconnect();
      void disconnect.catch(() => undefined);
    }
    void close.catch(() => undefined);
    void this.workerRun?.catch(() => undefined);
    this.workerRun = null;
  }

  async isReady() {
    if (!this.accepting || !this.worker || !this.queue) return false;
    try {
      await Promise.all([
        this.publisherConnection?.ping(),
        this.consumerConnection?.ping(),
      ]);
      return this.accepting;
    } catch {
      return false;
    }
  }

  async onApplicationShutdown() {
    this.accepting = false;
    const deadlineAt =
      this.shutdownDeadlineAt ??
      performance.now() + this.workerConfig().shutdownGraceMs;
    try {
      if (this.worker) {
        await completesBefore(this.worker.disconnect(), deadlineAt);
      }
      if (this.queue) {
        await completesBefore(this.queue.close(), deadlineAt);
      }
      await Promise.all([
        closeRedis(this.consumerConnection, deadlineAt),
        closeRedis(this.publisherConnection, deadlineAt),
      ]);
    } finally {
      this.worker = null;
      this.workerClose = null;
      this.queue = null;
      this.consumerConnection = null;
      this.publisherConnection = null;
    }
  }

  private async createConnections(redisUrl: string) {
    const publisher = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 3,
    });
    const consumer = new Redis(redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: null,
    });
    await Promise.all([publisher.connect(), consumer.connect()]);
    return { consumer, publisher };
  }

  private workerConfig() {
    return this.configService.getOrThrow<WorkerRuntimeConfig>("worker");
  }

  protected superviseWorkerRun(run: Promise<void>) {
    return run.then(
      () => this.handleUnexpectedWorkerStop(new Error("Runtime queue loop exited")),
      (error: unknown) => this.handleUnexpectedWorkerStop(error),
    );
  }

  protected handleUnexpectedWorkerStop(error: unknown) {
    if (!this.accepting) return;
    this.accepting = false;
    process.exitCode = 1;
    this.logger.error(`Runtime queue stopped unexpectedly: ${safeMessage(error)}`);
    this.requestProcessRestart();
  }

  protected requestProcessRestart() {
    process.kill(process.pid, "SIGTERM");
  }
}

export function runtimeQueueJobOptions(
  envelope: RuntimeDispatchEnvelope,
): JobsOptions {
  return {
    attempts: QUEUE_RETRY_ATTEMPTS,
    backoff: { delay: QUEUE_RETRY_DELAY_MS, type: "exponential" },
    jobId: envelope.dispatchId,
    // PostgreSQL is authoritative. Immediate removal is required so a durable
    // DB requeue can publish the same stable dispatchId after this delivery.
    removeOnComplete: true,
    removeOnFail: true,
  };
}

function readQueueAttempts(value: number | undefined) {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? value! : 1;
}

async function closeRedis(connection: Redis | null, deadlineAt: number) {
  if (!connection || connection.status === "end") return;
  try {
    if (!(await completesBefore(connection.quit(), deadlineAt))) {
      connection.disconnect(false);
    }
  } catch {
    connection.disconnect(false);
  }
}

async function completesBefore(work: Promise<unknown>, deadlineAt: number) {
  const timeoutMs = Math.max(0, Math.ceil(deadlineAt - performance.now()));
  if (timeoutMs === 0) {
    void work.catch(() => undefined);
    return false;
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then(
        () => true,
        () => false,
      ),
      new Promise<false>((resolve) => {
        timeout = setTimeout(() => resolve(false), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}
