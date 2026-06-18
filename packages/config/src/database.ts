/**
 * PostgreSQL connection configuration.
 *
 * All values can be overridden via environment variables.
 * Works with the docker-compose.yml defaults out of the box.
 */
export const databaseConfig = {
  host: process.env.POSTGRES_HOST ?? "localhost",
  port: Number(process.env.POSTGRES_PORT ?? 5432),
  user: process.env.POSTGRES_USER ?? "hermes",
  password: process.env.POSTGRES_PASSWORD ?? "hermes_dev_pwd",
  database: process.env.POSTGRES_DB ?? "hermes_dev",
} as const;

/** Build a connection string from the current config (or POSTGRES_URL). */
export function getPostgresUrl(): string {
  if (process.env.POSTGRES_URL) {
    return process.env.POSTGRES_URL;
  }
  const { host, port, user, password, database } = databaseConfig;
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}
