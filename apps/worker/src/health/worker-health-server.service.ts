import { createServer, type Server, type ServerResponse } from "node:http";
import {
  Injectable,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";
import { WorkerHealthService } from "./worker-health.service.js";

@Injectable()
export class WorkerHealthServerService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private server: Server | null = null;

  constructor(
    private readonly health: WorkerHealthService,
    private readonly configService: ConfigService,
  ) {}

  async onApplicationBootstrap() {
    const server = createServer((request, response) => {
      void this.respond(request.method ?? "GET", request.url ?? "/", response);
    });
    const { healthPort } = this.configService.getOrThrow<WorkerRuntimeConfig>(
      "worker",
    );
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      server.once("error", onError);
      server.listen(healthPort, "0.0.0.0", () => {
        server.off("error", onError);
        resolve();
      });
    });
    this.server = server;
  }

  async onApplicationShutdown() {
    const server = this.server;
    this.server = null;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private async respond(method: string, url: string, response: ServerResponse) {
    response.setHeader("content-type", "application/json; charset=utf-8");
    response.setHeader("cache-control", "no-store");
    if (method !== "GET") {
      writeJson(response, 405, { status: "error" });
      return;
    }
    const pathname = new URL(url, "http://worker.local").pathname;
    if (pathname === "/health/live") {
      writeJson(response, 200, this.health.live());
      return;
    }
    if (pathname === "/health/ready") {
      const status = await this.health.ready();
      writeJson(response, status.status === "ok" ? 200 : 503, status);
      return;
    }
    writeJson(response, 404, { status: "not-found" });
  }
}

function writeJson(response: ServerResponse, statusCode: number, value: unknown) {
  response.statusCode = statusCode;
  response.end(JSON.stringify(value));
}
