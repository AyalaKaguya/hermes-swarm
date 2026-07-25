import path from "node:path";
import { registerAs } from "@nestjs/config";

export const DEFAULT_RUNTIME_QUEUE_NAME = "runtime";
export const DEFAULT_RUNTIME_QUEUE_PREFIX = "hermes";

export type WorkerRuntimeConfig = Readonly<{
  healthPort: number;
  outboxBatchSize: number;
  outboxLeaseMs: number;
  outboxPollMs: number;
  outboxReconcileMs: number;
  postgresUrl: string;
  queueName: string;
  queuePrefix: string;
  redisUrl: string;
  shutdownGraceMs: number;
  workerConcurrency: number;
}>;

export const workerRuntimeConfig = registerAs("worker", () =>
  readWorkerRuntimeConfig(process.env),
);

export function readWorkerRuntimeConfig(
  env: NodeJS.ProcessEnv,
): WorkerRuntimeConfig {
  const isTest = (env.NODE_ENV ?? "development") === "test";
  const postgresVariable = isTest ? "POSTGRES_TEST_URL" : "POSTGRES_URL";
  const postgresUrl = requireUrl(
    isTest ? env.POSTGRES_TEST_URL : env.POSTGRES_URL,
    postgresVariable,
    ["postgresql:"],
  );
  const redisUrl = requireUrl(env.REDIS_URL, "REDIS_URL", [
    "redis:",
    "rediss:",
  ]);
  const queueName = parseQueueName(
    env.RUNTIME_QUEUE_NAME,
    "RUNTIME_QUEUE_NAME",
    DEFAULT_RUNTIME_QUEUE_NAME,
  );
  const queuePrefix = parseQueuePrefix(
    env.RUNTIME_QUEUE_PREFIX,
    DEFAULT_RUNTIME_QUEUE_PREFIX,
  );

  return Object.freeze({
    healthPort: parseIntegerInRange(
      env.WORKER_HEALTH_PORT,
      "WORKER_HEALTH_PORT",
      3_210,
      1,
      65_535,
    ),
    outboxBatchSize: parseIntegerInRange(
      env.OUTBOX_BATCH_SIZE,
      "OUTBOX_BATCH_SIZE",
      50,
      1,
      1_000,
    ),
    outboxLeaseMs: parseIntegerInRange(
      env.OUTBOX_LEASE_MS,
      "OUTBOX_LEASE_MS",
      30_000,
      1_000,
      15 * 60_000,
    ),
    outboxPollMs: parseIntegerInRange(
      env.OUTBOX_POLL_MS,
      "OUTBOX_POLL_MS",
      1_000,
      50,
      60_000,
    ),
    outboxReconcileMs: parseIntegerInRange(
      env.OUTBOX_RECONCILE_MS,
      "OUTBOX_RECONCILE_MS",
      60_000,
      1_000,
      24 * 60 * 60_000,
    ),
    postgresUrl,
    queueName,
    queuePrefix,
    redisUrl,
    shutdownGraceMs: parseIntegerInRange(
      env.WORKER_SHUTDOWN_GRACE_MS,
      "WORKER_SHUTDOWN_GRACE_MS",
      30_000,
      1_000,
      10 * 60_000,
    ),
    workerConcurrency: parseIntegerInRange(
      env.WORKER_CONCURRENCY,
      "WORKER_CONCURRENCY",
      4,
      1,
      256,
    ),
  });
}

export function validateWorkerRuntimeEnvironment(
  config: Record<string, unknown>,
) {
  readWorkerRuntimeConfig(
    Object.fromEntries(
      Object.entries(config).map(([key, value]) => [
        key,
        value === undefined || value === null ? undefined : String(value),
      ]),
    ),
  );
  return config;
}

export function getWorkerEnvFilePaths() {
  return [
    path.resolve(process.cwd(), "apps/worker/.env"),
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
}

function requireUrl(
  value: string | undefined,
  name: string,
  protocols: readonly string[],
) {
  const text = value?.trim();
  if (!text) throw new Error(`${name} is required`);
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (!protocols.includes(parsed.protocol)) {
    throw new Error(
      `${name} must use ${protocols.map((protocol) => `${protocol}//`).join(" or ")}`,
    );
  }
  return parsed.toString();
}

function parseIntegerInRange(
  value: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const parsed = value?.trim() ? Number(value) : fallback;
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseQueueName(
  value: string | undefined,
  name: string,
  fallback: string,
) {
  const text = value?.trim() || fallback;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,119}$/.test(text)) {
    throw new Error(
      `${name} must start with an alphanumeric character and contain only letters, numbers, dot, underscore, or dash`,
    );
  }
  return text;
}

function parseQueuePrefix(value: string | undefined, fallback: string) {
  const text = value?.trim() || fallback;
  if (text.length > 120 || /[{}\s]/.test(text)) {
    throw new Error(
      "RUNTIME_QUEUE_PREFIX must be at most 120 characters and cannot contain whitespace or braces",
    );
  }
  return text;
}
