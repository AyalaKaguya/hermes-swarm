/**
 * Redis connection configuration.
 *
 * All values can be overridden via environment variables.
 * Works with the docker-compose.yml defaults out of the box.
 */
export const redisConfig = {
  host: process.env.REDIS_HOST ?? "localhost",
  port: Number(process.env.REDIS_PORT ?? 6379),
  password: process.env.REDIS_PASSWORD ?? "hermes_redis_pwd",
} as const;

/** Build a Redis connection URL from the current config (or REDIS_URL). */
export function getRedisUrl(): string {
  if (process.env.REDIS_URL) {
    return process.env.REDIS_URL;
  }
  const { host, port, password } = redisConfig;
  return `redis://:${password}@${host}:${port}`;
}
