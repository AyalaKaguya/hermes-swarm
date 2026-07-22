import * as path from "node:path";
import { registerAs } from "@nestjs/config";
import {
  readTrustedProxyCidrs,
  validateTrustedProxyCidrs,
} from "@hermes-swarm/rbac";

export const appRuntimeConfig = registerAs("app", () => ({
  corsOrigin: parseCorsOrigin(process.env.CORS_ORIGIN),
  port: parseInteger(process.env.API_PORT, 3200),
  trustedProxyCidrs: readTrustedProxyCidrs(process.env),
}));

export const databaseRuntimeConfig = registerAs("database", () => {
  validateLegacyRlsConfiguration(process.env);
  const environment = process.env.NODE_ENV ?? "development";
  const isTest = environment === "test";
  const name = isTest ? "POSTGRES_TEST_URL" : "POSTGRES_URL";
  const url = isTest ? process.env.POSTGRES_TEST_URL : process.env.POSTGRES_URL;
  if (!url) {
    throw new Error(
      isTest
        ? "POSTGRES_TEST_URL is required when NODE_ENV=test"
        : "POSTGRES_URL is required unless NODE_ENV=test",
    );
  }
  validateUrl(name, url, "postgresql:");
  return {
    synchronize: parseBoolean(process.env.DATABASE_SYNCHRONIZE, false),
    url,
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
  sessionKeyId: process.env.AUTH_SESSION_KEY_ID ?? "current",
  previousSessionKeys: parseKeyring(process.env.AUTH_SESSION_PREVIOUS_KEYS),
}));

export const settingsRuntimeConfig = registerAs("settings", () => ({
  encryptionKey:
    process.env.SETTINGS_ENCRYPTION_KEY ??
    process.env.AUTH_SESSION_SECRET ??
    process.env.JWT_SECRET ??
    "hermes-swarm-local-settings-secret",
  encryptionKeyId: process.env.SETTINGS_ENCRYPTION_KEY_ID ?? "current",
  previousEncryptionKeys: parseKeyring(
    process.env.SETTINGS_PREVIOUS_ENCRYPTION_KEYS,
  ),
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
  validateTrustedProxyCidrs(config.TRUSTED_PROXY_CIDRS);
  validateLegacyRlsConfiguration(config);
  validateUrl("POSTGRES_TEST_URL", config.POSTGRES_TEST_URL, "postgresql:");
  if (environment !== "test") {
    validateUrl("POSTGRES_URL", config.POSTGRES_URL, "postgresql:");
  }
  validateBoolean("DATABASE_SYNCHRONIZE", config.DATABASE_SYNCHRONIZE);
  if (
    environment === "production" &&
    parseBoolean(String(config.DATABASE_SYNCHRONIZE ?? "false"), false)
  ) {
    throw new Error("DATABASE_SYNCHRONIZE must be false in production");
  }
  if (environment === "test" && !config.POSTGRES_TEST_URL) {
    throw new Error("POSTGRES_TEST_URL is required when NODE_ENV=test");
  }
  if (environment !== "test" && !config.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is required unless NODE_ENV=test");
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
  validateText(
    "SETTINGS_ENCRYPTION_KEY",
    config.SETTINGS_ENCRYPTION_KEY ??
      config.AUTH_SESSION_SECRET ??
      config.JWT_SECRET,
    "hermes-swarm-local-settings-secret",
  );
  if (environment === "production") {
    validateProductionSecrets(config);
  }
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

function validateLegacyRlsConfiguration(config: Record<string, unknown>) {
  const names = [
    "DATABASE_STRICT_RLS",
    "POSTGRES_PLATFORM_URL",
    "POSTGRES_WORKSPACE_URL",
  ].filter((name) => {
    const value = config[name];
    return value !== undefined && value !== null && String(value).trim() !== "";
  });
  if (names.length > 0) {
    throw new Error(
      `Legacy RLS database configuration is no longer supported (${names.join(", ")}). Remove it and configure POSTGRES_URL instead.`,
    );
  }
}

function validateProductionSecrets(config: Record<string, unknown>) {
  const names = [
    "AUTH_SESSION_SECRET",
    "WEB_SESSION_SECRET",
    "SETTINGS_ENCRYPTION_KEY",
    "INVITE_TOKEN_SECRET",
    "PASSWORD_RESET_TOKEN_SECRET",
  ] as const;
  const values = names.map((name) => {
    const value = typeof config[name] === "string" ? config[name].trim() : "";
    if (!value) throw new Error(`${name} is required in production`);
    if (decodedSecretLength(value) < 32) {
      throw new Error(`${name} must contain at least 32 bytes of key material`);
    }
    if (/hermes-swarm|dev-|local-|change-me|example/i.test(value)) {
      throw new Error(`${name} cannot use a public or development default`);
    }
    return value;
  });
  if (new Set(values).size !== values.length) {
    throw new Error("Production security secrets must be independent");
  }
}

function decodedSecretLength(value: string) {
  if (/^[a-f0-9]{64,}$/i.test(value) && value.length % 2 === 0) {
    return Buffer.from(value, "hex").length;
  }
  if (/^[A-Za-z0-9_-]{43,}={0,2}$/.test(value)) {
    try {
      return Buffer.from(value, "base64url").length;
    } catch {
      // Fall through to UTF-8 for explicitly textual secrets.
    }
  }
  return Buffer.byteLength(value, "utf8");
}

function parseKeyring(value: string | undefined) {
  if (!value?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("Keyring configuration must be a JSON object");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Keyring configuration must be a JSON object");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([keyId, secret]) => {
      if (!keyId.trim() || typeof secret !== "string" || !secret.trim()) {
        throw new Error("Keyring entries require a key id and secret");
      }
      return [keyId.trim(), secret];
    }),
  );
}
