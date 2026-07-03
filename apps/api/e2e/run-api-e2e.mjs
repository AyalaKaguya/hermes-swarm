import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(apiRoot, "../..");

loadEnvFile(resolve(workspaceRoot, ".env"));

const e2eDatabase = process.env.POSTGRES_E2E_DB ?? "hermes-e2e";
const baseDatabaseUrl = process.env.POSTGRES_URL
  ? new URL(process.env.POSTGRES_URL)
  : undefined;
const postgresAdminDatabase =
  process.env.POSTGRES_ADMIN_DB ??
  process.env.POSTGRES_DB ??
  baseDatabaseUrl?.pathname.slice(1) ??
  "postgres";
const postgresHost = process.env.POSTGRES_HOST ?? baseDatabaseUrl?.hostname ?? "localhost";
const postgresPassword =
  process.env.POSTGRES_PASSWORD ??
  (baseDatabaseUrl ? decodeURIComponent(baseDatabaseUrl.password) : undefined) ??
  "hermes_dev_pwd";
const postgresPort = Number(
  process.env.POSTGRES_PORT ?? baseDatabaseUrl?.port ?? 5432,
);
const postgresUser =
  process.env.POSTGRES_USER ??
  (baseDatabaseUrl ? decodeURIComponent(baseDatabaseUrl.username) : undefined) ??
  "hermes";
const e2eDatabaseUrl =
  process.env.POSTGRES_E2E_URL ??
  `postgresql://${encodeURIComponent(postgresUser)}:${encodeURIComponent(
    postgresPassword,
  )}@${postgresHost}:${postgresPort}/${encodeURIComponent(e2eDatabase)}`;

await ensureE2EDatabase();

console.log(`Running API e2e tests against ${redactDatabaseUrl(e2eDatabaseUrl)}`);

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
      RBAC_SYNC_CATALOG_ENABLED: "false",
      TYPEORM_CACHE_ENABLED: "false",
    },
    stdio: "inherit",
    timeout: Number(process.env.API_E2E_TIMEOUT_MS ?? 600_000),
  },
);

if (result.error) {
  console.error(result.error);
}
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
    } else {
      await client.query(
        `
          select pg_terminate_backend(pid)
          from pg_stat_activity
          where datname = $1
            and pid <> pg_backend_pid()
        `,
        [e2eDatabase],
      );
    }
    console.log(
      `Prepared PostgreSQL database ${e2eDatabase} at ${postgresHost}:${postgresPort}`,
    );
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

function redactDatabaseUrl(value) {
  const url = new URL(value);
  if (url.password) url.password = "****";
  return url.toString();
}

function loadEnvFile(path) {
  if (!existsSync(path)) return;

  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;

    const [, key, rawValue] = match;
    if (process.env[key] !== undefined) continue;

    process.env[key] = parseEnvValue(rawValue);
  }
}

function parseEnvValue(rawValue) {
  const value = rawValue.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value
      .slice(1, -1)
      .replaceAll("\\n", "\n")
      .replaceAll("\\r", "\r")
      .replaceAll("\\t", "\t");
  }
  return value.replace(/\s+#.*$/, "");
}
