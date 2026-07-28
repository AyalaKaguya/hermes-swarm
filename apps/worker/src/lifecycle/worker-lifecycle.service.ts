import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { performance } from "node:perf_hooks";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";
import { WorkerHealthService } from "../health/worker-health.service.js";
import { OutboxDispatcherService } from "../outbox/outbox-dispatcher.service.js";
import {
  WORKER_CONSUMER,
  type WorkerConsumerControl,
} from "./worker-lifecycle.types.js";

@Injectable()
export class WorkerLifecycleService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private readonly logger = new Logger(WorkerLifecycleService.name);
  private shutdownPromise: Promise<void> | null = null;

  constructor(
    @Inject(WORKER_CONSUMER)
    private readonly consumer: WorkerConsumerControl,
    private readonly dispatcher: OutboxDispatcherService,
    private readonly health: WorkerHealthService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    await this.consumer.start();
    this.dispatcher.start();
    this.health.markReady();
  }

  async beforeApplicationShutdown(signal?: string) {
    this.shutdownPromise ??= this.shutdown(signal);
    await this.shutdownPromise;
  }

  private async shutdown(signal?: string) {
    const startedAt = performance.now();
    this.health.beginDrain();
    this.logger.log(`Worker draining${signal ? ` after ${signal}` : ""}`);
    const { shutdownGraceMs } =
      this.configService.getOrThrow<WorkerRuntimeConfig>("worker");
    const deadlineAt = startedAt + shutdownGraceMs;

    await this.runShutdownStep(
      "pause runtime intake",
      this.consumer.pause(),
      deadlineAt,
    );
    await this.runShutdownStep(
      "stop Outbox dispatcher",
      this.dispatcher.stop(),
      deadlineAt,
    );
    await this.runShutdownStep(
      "drain runtime jobs",
      this.consumer.drain(remainingMs(deadlineAt)),
      deadlineAt,
    );
  }

  private async runShutdownStep(
    description: string,
    work: Promise<void>,
    deadlineAt: number,
  ) {
    const result = await settleBefore(work, deadlineAt);
    if (result.kind === "completed") return;
    process.exitCode = 1;
    this.logger.warn(
      result.kind === "timed-out"
        ? `Worker shutdown deadline exceeded while attempting to ${description}`
        : `Worker failed to ${description}: ${safeMessage(result.error)}`,
    );
  }
}

type Settlement =
  | { kind: "completed" }
  | { error: unknown; kind: "failed" }
  | { kind: "timed-out" };

async function settleBefore(
  work: Promise<void>,
  deadlineAt: number,
): Promise<Settlement> {
  const timeoutMs = remainingMs(deadlineAt);
  if (timeoutMs === 0) {
    void work.catch(() => undefined);
    return { kind: "timed-out" };
  }

  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      work.then<Settlement, Settlement>(
        () => ({ kind: "completed" }),
        (error: unknown) => ({ error, kind: "failed" }),
      ),
      new Promise<Settlement>((resolve) => {
        timeout = setTimeout(() => resolve({ kind: "timed-out" }), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function remainingMs(deadlineAt: number) {
  return Math.max(0, Math.ceil(deadlineAt - performance.now()));
}

function safeMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}
