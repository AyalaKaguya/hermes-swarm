/**
 * Redis connection configuration.
 *
 * All values can be overridden via environment variables.
 * Works with the docker-compose.yml defaults out of the box.
 */
export const redisConfig = {
  get host() {
    return process.env.REDIS_HOST ?? "localhost";
  },
  get port() {
    return Number(process.env.REDIS_PORT ?? 6379);
  },
  get password() {
    return process.env.REDIS_PASSWORD ?? "hermes_redis_pwd";
  },
} as const;

export const typeormRedisCacheConfig = {
  get alwaysEnabled() {
    return parseBooleanEnv("TYPEORM_CACHE_ALWAYS_ENABLED", false);
  },
  get durationMs() {
    return parsePositiveIntegerEnv("TYPEORM_CACHE_DURATION_MS", 30_000);
  },
  get enabled() {
    return parseBooleanEnv("TYPEORM_CACHE_ENABLED", true);
  },
  get ignoreErrors() {
    return parseBooleanEnv("TYPEORM_CACHE_IGNORE_ERRORS", true);
  },
} as const;

/** Build a Redis connection URL from the current config (or REDIS_URL). */
export function getRedisUrl(): string {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  const { host, port, password } = redisConfig;
  return `redis://:${password}@${host}:${port}`;
}

export function getTypeOrmRedisCacheOptions() {
  return {
    alwaysEnabled: typeormRedisCacheConfig.alwaysEnabled,
    duration: typeormRedisCacheConfig.durationMs,
    ignoreErrors: typeormRedisCacheConfig.ignoreErrors,
    options: {
      url: getRedisUrl(),
    },
    type: "redis" as const,
  };
}

function parseBooleanEnv(name: string, fallback: boolean) {
  const value = process.env[name];
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
      return fallback;
  }
}

function parsePositiveIntegerEnv(name: string, fallback: number) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}
