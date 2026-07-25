import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_RUNTIME_QUEUE_NAME,
  DEFAULT_RUNTIME_QUEUE_PREFIX,
  readWorkerRuntimeConfig,
} from "./worker-runtime.config.js";

const required = {
  POSTGRES_URL: "postgresql://worker:secret@db.example/hermes",
  REDIS_URL: "rediss://cache.example:6380/0",
};

describe("worker runtime config", () => {
  it("uses bounded defaults for optional worker controls", () => {
    const config = readWorkerRuntimeConfig(required);

    assert.deepEqual(config, {
      healthPort: 3_210,
      outboxBatchSize: 50,
      outboxLeaseMs: 30_000,
      outboxPollMs: 1_000,
      outboxReconcileMs: 60_000,
      postgresUrl: "postgresql://worker:secret@db.example/hermes",
      queueName: DEFAULT_RUNTIME_QUEUE_NAME,
      queuePrefix: DEFAULT_RUNTIME_QUEUE_PREFIX,
      redisUrl: "rediss://cache.example:6380/0",
      shutdownGraceMs: 30_000,
      workerConcurrency: 4,
    });
    assert.equal(Object.isFrozen(config), true);
  });

  it("rejects missing or unsupported infrastructure URLs", () => {
    assert.throws(
      () => readWorkerRuntimeConfig({ REDIS_URL: required.REDIS_URL }),
      /POSTGRES_URL is required/,
    );
    assert.throws(
      () =>
        readWorkerRuntimeConfig({
          ...required,
          REDIS_URL: "https://cache.example",
        }),
      /REDIS_URL must use redis:\/\/ or rediss:\/\//,
    );
  });

  it("uses only POSTGRES_TEST_URL when NODE_ENV=test", () => {
    const config = readWorkerRuntimeConfig({
      ...required,
      NODE_ENV: "test",
      POSTGRES_TEST_URL: "postgresql://worker:test@db.example/hermes_test",
    });

    assert.equal(
      config.postgresUrl,
      "postgresql://worker:test@db.example/hermes_test",
    );
    assert.throws(
      () =>
        readWorkerRuntimeConfig({
          ...required,
          NODE_ENV: "test",
        }),
      /POSTGRES_TEST_URL is required/,
    );
  });

  it("does not fall back to POSTGRES_TEST_URL outside test mode", () => {
    assert.throws(
      () =>
        readWorkerRuntimeConfig({
          NODE_ENV: "development",
          POSTGRES_TEST_URL: "postgresql://db.example/hermes_test",
          REDIS_URL: required.REDIS_URL,
        }),
      /POSTGRES_URL is required/,
    );
  });

  it("rejects invalid queue names and out-of-range controls", () => {
    assert.throws(
      () =>
        readWorkerRuntimeConfig({
          ...required,
          RUNTIME_QUEUE_NAME: "runtime:dispatch",
        }),
      /RUNTIME_QUEUE_NAME/,
    );
    assert.throws(
      () =>
        readWorkerRuntimeConfig({
          ...required,
          WORKER_CONCURRENCY: "0",
        }),
      /WORKER_CONCURRENCY/,
    );
    assert.throws(
      () =>
        readWorkerRuntimeConfig({
          ...required,
          OUTBOX_BATCH_SIZE: "1.5",
        }),
      /OUTBOX_BATCH_SIZE/,
    );
    assert.throws(
      () =>
        readWorkerRuntimeConfig({
          ...required,
          OUTBOX_RECONCILE_MS: "999",
        }),
      /OUTBOX_RECONCILE_MS/,
    );
  });

  it("accepts a bounded Outbox reconciliation window", () => {
    const config = readWorkerRuntimeConfig({
      ...required,
      OUTBOX_RECONCILE_MS: "120000",
    });

    assert.equal(config.outboxReconcileMs, 120_000);
  });
});
