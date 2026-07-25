import { Inject, Injectable } from "@nestjs/common";
import { DataSource } from "typeorm";
import { RUNTIME_QUEUE, type RuntimeQueue } from "../outbox/outbox.types.js";
import type { WorkerHealthProbe } from "./worker-health.service.js";

@Injectable()
export class WorkerDependenciesHealthProbeService
  implements WorkerHealthProbe
{
  constructor(
    private readonly dataSource: DataSource,
    @Inject(RUNTIME_QUEUE) private readonly queue: RuntimeQueue,
  ) {}

  async check() {
    const [, queueReady] = await Promise.all([
      this.dataSource.query("SELECT 1"),
      this.queue.isReady(),
    ]);
    if (!queueReady) throw new Error("Runtime queue is unavailable");
  }
}
