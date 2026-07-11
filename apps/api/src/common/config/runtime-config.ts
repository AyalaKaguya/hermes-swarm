import * as path from "node:path";
import { registerAs } from "@nestjs/config";

export const appRuntimeConfig = registerAs("app", () => ({
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  port: parseInteger(process.env.API_PORT, 3200),
}));

export const databaseRuntimeConfig = registerAs("database", () => {
  const environment = process.env.NODE_ENV ?? "development";
  const host = process.env.POSTGRES_HOST ?? "localhost";
  const port = parseInteger(process.env.POSTGRES_PORT, 5432);
  const user = process.env.POSTGRES_USER ?? "hermes";
  const password = process.env.POSTGRES_PASSWORD ?? "hermes_dev_pwd";
  const database = process.env.POSTGRES_DB ?? "hermes_dev";
  const fallbackUrl =
    process.env.POSTGRES_URL ??
    `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${database}`;
  const testUrl = environment === "test" ? process.env.POSTGRES_TEST_URL : undefined;
  const tenantUrl = testUrl ?? process.env.POSTGRES_TENANT_URL ?? fallbackUrl;
  const platformUrl = testUrl ?? process.env.POSTGRES_PLATFORM_URL ?? fallbackUrl;
  return {
    database,
    host,
    migrationsRun: parseBoolean(process.env.DATABASE_MIGRATIONS_RUN, false),
    password,
    port,
    synchronize: parseBoolean(process.env.DATABASE_SYNCHRONIZE, false),
    strictRls: environment !== "test",
    platformUrl,
    tenantUrl,
    // Backwards-compatible alias used by the migration datasource.
    url: tenantUrl,
    user,
  };
});

export const redisRuntimeConfig = registerAs("redis", () => {
  const host = process.env.REDIS_HOST ?? "localhost";
  const port = parseInteger(process.env.REDIS_PORT, 6379);
  const password = process.env.REDIS_PASSWORD ?? "hermes_redis_pwd";
  return {
    cacheAlwaysEnabled: parseBoolean(
      process.env.TYPEORM_CACHE_ALWAYS_ENABLED,
      false,
    ),
    cacheDurationMs: parseInteger(process.env.TYPEORM_CACHE_DURATION_MS, 30_000),
    cacheEnabled: parseBoolean(process.env.TYPEORM_CACHE_ENABLED, true),
    cacheIgnoreErrors: parseBoolean(
      process.env.TYPEORM_CACHE_IGNORE_ERRORS,
      true,
    ),
    host,
    password,
    port,
    url:
      process.env.REDIS_URL ??
      `redis://:${encodeURIComponent(password)}@${host}:${port}`,
  };
});

export const authRuntimeConfig = registerAs("auth", () => ({
  accessTokenTtlSeconds: parseInteger(
    process.env.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    900,
  ),
  refreshCookieName: process.env.AUTH_REFRESH_COOKIE_NAME ?? "hermes_refresh",
  refreshCookieSecure: parseBoolean(
    process.env.AUTH_REFRESH_COOKIE_SECURE,
    false,
  ),
  refreshTokenTtlSeconds: parseInteger(
    process.env.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    2_592_000,
  ),
  sessionSecret:
    process.env.AUTH_SESSION_SECRET ??
    process.env.JWT_SECRET ??
    "hermes-swarm-local-auth-secret",
}));

export function getApiEnvFilePaths() {
  return [
    path.resolve(process.cwd(), ".env"),
    path.resolve(process.cwd(), "../../.env"),
  ];
}

export function validateRuntimeConfig(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const environment = String(config.NODE_ENV ?? "development");
  validatePort("API_PORT", config.API_PORT, { fallback: 3200 });
  validateUrl("POSTGRES_URL", config.POSTGRES_URL, "postgresql:");
  validateUrl("POSTGRES_TENANT_URL", config.POSTGRES_TENANT_URL, "postgresql:");
  validateUrl("POSTGRES_PLATFORM_URL", config.POSTGRES_PLATFORM_URL, "postgresql:");
  validateText("POSTGRES_HOST", config.POSTGRES_HOST, "localhost");
  validatePort("POSTGRES_PORT", config.POSTGRES_PORT, { fallback: 5432 });
  validateText("POSTGRES_USER", config.POSTGRES_USER, "hermes");
  validateText("POSTGRES_PASSWORD", config.POSTGRES_PASSWORD, "hermes_dev_pwd");
  validateText("POSTGRES_DB", config.POSTGRES_DB, "hermes_dev");
  validateUrl("POSTGRES_TEST_URL", config.POSTGRES_TEST_URL, "postgresql:");
  validateBoolean("DATABASE_SYNCHRONIZE", config.DATABASE_SYNCHRONIZE);
  validateBoolean("DATABASE_MIGRATIONS_RUN", config.DATABASE_MIGRATIONS_RUN);
  validateBoolean("DATABASE_STRICT_RLS", config.DATABASE_STRICT_RLS);
  if (
    environment !== "test" &&
    config.DATABASE_STRICT_RLS !== undefined &&
    !parseBoolean(String(config.DATABASE_STRICT_RLS), true)
  ) {
    throw new Error("DATABASE_STRICT_RLS must remain enabled outside tests");
  }
  if (
    environment === "production" &&
    parseBoolean(String(config.DATABASE_SYNCHRONIZE ?? "false"), false)
  ) {
    throw new Error("DATABASE_SYNCHRONIZE must be false in production");
  }
  if (
    environment === "production" &&
    parseBoolean(String(config.DATABASE_MIGRATIONS_RUN ?? "false"), false)
  ) {
    throw new Error(
      "DATABASE_MIGRATIONS_RUN is not supported by API startup; run migrations before deploying",
    );
  }
  if (environment === "test" && !config.POSTGRES_TEST_URL) {
    throw new Error("POSTGRES_TEST_URL is required when NODE_ENV=test");
  }
  if (environment !== "test") {
    if (!config.POSTGRES_TENANT_URL || !config.POSTGRES_PLATFORM_URL) {
      throw new Error(
        "POSTGRES_TENANT_URL and POSTGRES_PLATFORM_URL are required outside tests",
      );
    }
    if (String(config.POSTGRES_TENANT_URL) === String(config.POSTGRES_PLATFORM_URL)) {
      throw new Error(
        "POSTGRES_TENANT_URL and POSTGRES_PLATFORM_URL must use separate database credentials",
      );
    }
    const tenantUser = databaseUrlUsername(config.POSTGRES_TENANT_URL);
    const platformUser = databaseUrlUsername(config.POSTGRES_PLATFORM_URL);
    if (tenantUser !== "hermes_tenant_app") {
      throw new Error(
        "POSTGRES_TENANT_URL must authenticate as hermes_tenant_app",
      );
    }
    if (!platformUser || platformUser === tenantUser) {
      throw new Error(
        "POSTGRES_PLATFORM_URL must use a database user distinct from hermes_tenant_app",
      );
    }
  }
  validateUrl("REDIS_URL", config.REDIS_URL, "redis:");
  validateText("REDIS_HOST", config.REDIS_HOST, "localhost");
  validatePort("REDIS_PORT", config.REDIS_PORT, { fallback: 6379 });
  validateText("REDIS_PASSWORD", config.REDIS_PASSWORD, "hermes_redis_pwd");
  validateBoolean("TYPEORM_CACHE_ENABLED", config.TYPEORM_CACHE_ENABLED);
  validateBoolean(
    "TYPEORM_CACHE_ALWAYS_ENABLED",
    config.TYPEORM_CACHE_ALWAYS_ENABLED,
  );
  validateBoolean(
    "TYPEORM_CACHE_IGNORE_ERRORS",
    config.TYPEORM_CACHE_IGNORE_ERRORS,
  );
  validatePositiveInteger(
    "TYPEORM_CACHE_DURATION_MS",
    config.TYPEORM_CACHE_DURATION_MS,
    30_000,
  );
  validatePositiveInteger(
    "AUTH_ACCESS_TOKEN_TTL_SECONDS",
    config.AUTH_ACCESS_TOKEN_TTL_SECONDS,
    900,
  );
  validatePositiveInteger(
    "AUTH_REFRESH_TOKEN_TTL_SECONDS",
    config.AUTH_REFRESH_TOKEN_TTL_SECONDS,
    2_592_000,
  );
  validateText(
    "AUTH_REFRESH_COOKIE_NAME",
    config.AUTH_REFRESH_COOKIE_NAME,
    "hermes_refresh",
  );
  validateBoolean(
    "AUTH_REFRESH_COOKIE_SECURE",
    config.AUTH_REFRESH_COOKIE_SECURE,
  );
  validateText(
    "AUTH_SESSION_SECRET",
    config.AUTH_SESSION_SECRET ?? config.JWT_SECRET,
    "hermes-swarm-local-auth-secret",
  );
  return config;
}

export function parseBoolean(
  value: string | undefined,
  fallback: boolean,
) {
  if (!value) return fallback;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "on":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(`Invalid boolean value: ${value}`);
  }
}

export function parseInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error(`Invalid integer value: ${value}`);
  }
  return parsed;
}

function parseCorsOrigin(value: string | undefined) {
  const origins = value
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (origins && origins.length > 0) return origins;
  return process.env.NODE_ENV === "production" ? false : true;
}

function validateBoolean(name: string, value: unknown) {
  if (value === undefined || value === null || value === "") return;
  parseBoolean(String(value), false);
}

function validatePort(
  name: string,
  value: unknown,
  { fallback }: { fallback: number },
) {
  const parsed = parseInteger(
    value === undefined || value === null || value === ""
      ? undefined
      : String(value),
    fallback,
  );
  if (parsed < 1 || parsed > 65_535) {
    throw new Error(`${name} must be a TCP port between 1 and 65535`);
  }
}

function validatePositiveInteger(
  name: string,
  value: unknown,
  fallback: number,
) {
  const parsed = parseInteger(
    value === undefined || value === null || value === ""
      ? undefined
      : String(value),
    fallback,
  );
  if (parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
}

function validateText(name: string, value: unknown, fallback: string) {
  const text =
    value === undefined || value === null || value === ""
      ? fallback
      : String(value);
  if (!text.trim()) throw new Error(`${name} cannot be empty`);
}

function validateUrl(name: string, value: unknown, protocol: string) {
  if (value === undefined || value === null || value === "") return;
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`${name} must be a valid URL`);
  }
  if (url.protocol !== protocol) {
    throw new Error(`${name} must use ${protocol}//`);
  }
}

function databaseUrlUsername(value: unknown) {
  if (typeof value !== "string" || !value) return "";
  try {
    return decodeURIComponent(new URL(value).username);
  } catch {
    return "";
  }
}
