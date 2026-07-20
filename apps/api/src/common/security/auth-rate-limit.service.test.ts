import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthRateLimitService, rateLimitHash } from "./auth-rate-limit.service.js";

describe("AuthRateLimitService", () => {
  it("uses Redis counters and returns a stable 429 response with Retry-After", async () => {
    let count = 0;
    const redis = {
      getClient: async () => ({
        expire: async () => 1,
        incr: async () => ++count,
        ttl: async () => 42,
      }),
    };
    const service = new AuthRateLimitService(redis as any);
    const headers = new Map<string, string>();
    const rule = [{ key: "login:test", limit: 1, windowSeconds: 300 }];

    await service.assertAllowed(rule);
    await assert.rejects(
      () =>
        service.assertAllowed(rule, {
          setHeader: (name, value) => headers.set(name, value),
        }),
      (error: any) =>
        error?.getStatus?.() === 429 &&
        error?.getResponse?.().code === "AUTH_RATE_LIMITED",
    );
    assert.equal(headers.get("Retry-After"), "42");
  });

  it("falls back conservatively when Redis is unavailable", async () => {
    const service = new AuthRateLimitService({
      getClient: async () => {
        throw new Error("redis unavailable");
      },
    } as any);
    const rule = [{ key: "reset:test", limit: 4, windowSeconds: 60 }];

    await service.assertAllowed(rule);
    await service.assertAllowed(rule);
    await assert.rejects(
      () => service.assertAllowed(rule),
      (error: any) => error?.getStatus?.() === 429,
    );
  });

  it("hashes normalized account identifiers without exposing the input", () => {
    const first = rateLimitHash(" Owner@Example.com ");
    assert.equal(first, rateLimitHash("owner@example.com"));
    assert.equal(first.includes("owner"), false);
  });
});
