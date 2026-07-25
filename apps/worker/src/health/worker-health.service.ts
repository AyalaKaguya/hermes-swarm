import { Inject, Injectable } from "@nestjs/common";

export const WORKER_HEALTH_PROBE = Symbol("WORKER_HEALTH_PROBE");

export interface WorkerHealthProbe {
  check(): Promise<void>;
}

export type WorkerReadiness =
  | { status: "ok" }
  | { reason: "starting" | "draining" | "dependency-unavailable"; status: "error" };

@Injectable()
export class WorkerHealthService {
  private state: "starting" | "ready" | "draining" = "starting";

  constructor(
    @Inject(WORKER_HEALTH_PROBE) private readonly probe: WorkerHealthProbe,
  ) {}

  live() {
    return { status: "ok" as const };
  }

  markReady() {
    if (this.state !== "draining") this.state = "ready";
  }

  beginDrain() {
    this.state = "draining";
  }

  async ready(): Promise<WorkerReadiness> {
    if (this.state !== "ready") {
      return { reason: this.state, status: "error" };
    }
    try {
      await this.probe.check();
      return { status: "ok" };
    } catch {
      return { reason: "dependency-unavailable", status: "error" };
    }
  }
}
