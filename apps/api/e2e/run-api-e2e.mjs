import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const e2eDatabase = process.env.POSTGRES_E2E_DB ?? "hermes-e2e";
const postgresAdminDatabase = process.env.POSTGRES_ADMIN_DB ?? "postgres";
const postgresHost = process.env.POSTGRES_HOST ?? "localhost";
const postgresPassword = process.env.POSTGRES_PASSWORD ?? "hermes_dev_pwd";
const postgresPort = Number(process.env.POSTGRES_PORT ?? 5432);
const postgresUser = process.env.POSTGRES_USER ?? "hermes";
const e2eDatabaseUrl =
  process.env.POSTGRES_E2E_URL ??
  `postgresql://${encodeURIComponent(postgresUser)}:${encodeURIComponent(
    postgresPassword,
  )}@${postgresHost}:${postgresPort}/${encodeURIComponent(e2eDatabase)}`;

await ensureE2EDatabase();

const result = spawnSync(
  process.execPath,
  ["--import", "tsx", "--test", "src/**/*.e2e-spec.ts"],
  {
    cwd: apiRoot,
    env: {
      ...process.env,
      POSTGRES_E2E_URL: e2eDatabaseUrl,
      POSTGRES_DB: e2eDatabase,
      POSTGRES_URL: e2eDatabaseUrl,
      TYPEORM_CACHE_ENABLED: "false",
    },
    stdio: "inherit",
  },
);

process.exit(result.status ?? 1);

async function ensureE2EDatabase() {
  const client = new pg.Client({
    database: postgresAdminDatabase,
    host: postgresHost,
    password: postgresPassword,
    port: postgresPort,
    user: postgresUser,
  });

  try {
    await client.connect();
    const existing = await client.query(
      "select 1 from pg_database where datname = $1",
      [e2eDatabase],
    );
    if (existing.rowCount === 0) {
      await client.query(`create database "${e2eDatabase.replaceAll('"', '""')}"`);
      console.log(`Created PostgreSQL database ${e2eDatabase}`);
    }
  } catch (error) {
    console.error(
      `Unable to prepare PostgreSQL database ${e2eDatabase} at ${postgresHost}:${postgresPort}.`,
    );
    console.error(
      "Start the repo Postgres service or provide POSTGRES_E2E_URL/POSTGRES_* values, then rerun the API e2e target.",
    );
    console.error(error);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }

  const e2eClient = new pg.Client({
    database: e2eDatabase,
    host: postgresHost,
    password: postgresPassword,
    port: postgresPort,
    user: postgresUser,
  });
  try {
    await e2eClient.connect();
    await e2eClient.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await e2eClient.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
  } finally {
    await e2eClient.end().catch(() => undefined);
  }
}
