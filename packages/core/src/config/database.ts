/**
 * PostgreSQL connection configuration.
 *
 * All values can be overridden via environment variables.
 * Works with the docker-compose.yml defaults out of the box.
 */
export const databaseConfig = {
  get host() {
    return process.env.POSTGRES_HOST ?? "localhost";
  },
  get port() {
    return Number(process.env.POSTGRES_PORT ?? 5432);
  },
  get user() {
    return process.env.POSTGRES_USER ?? "hermes";
  },
  get password() {
    return process.env.POSTGRES_PASSWORD ?? "hermes_dev_pwd";
  },
  get database() {
    return process.env.POSTGRES_DB ?? "hermes_dev";
  },
} as const;

/** Build a connection string from the current config (or POSTGRES_URL). */
export function getPostgresUrl(): string {
  if (process.env.POSTGRES_URL) {
    return process.env.POSTGRES_URL;
  }
  const { host, port, user, password, database } = databaseConfig;
  return `postgresql://${user}:${password}@${host}:${port}/${database}`;
}
