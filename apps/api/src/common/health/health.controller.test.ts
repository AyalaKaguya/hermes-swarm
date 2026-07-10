import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ServiceUnavailableException } from "@nestjs/common";
import { HealthController } from "./health.controller.js";

describe("HealthController", () => {
  it("reports liveness without probing dependencies", () => {
    const controller = new HealthController({} as any, {} as any);
    assert.deepEqual(controller.live(), { status: "ok" });
  });

  it("reports readiness when PostgreSQL and Redis are reachable", async () => {
    const controller = new HealthController(
      { query: async () => [{ "?column?": 1 }] } as any,
      { ping: async () => "PONG" } as any,
    );

    assert.deepEqual(await controller.ready(), {
      db: "connected",
      redis: "connected",
      status: "ok",
    });
  });

  it("returns 503 readiness when a dependency is unavailable", async () => {
    const controller = new HealthController(
      { query: async () => undefined } as any,
      { ping: async () => { throw new Error("redis unavailable"); } } as any,
    );

    await assert.rejects(() => controller.ready(), ServiceUnavailableException);
  });
});