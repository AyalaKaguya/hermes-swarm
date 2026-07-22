import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const apiRoot = fileURLToPath(new URL("..", import.meta.url));
const workspaceRoot = resolve(apiRoot, "../..");

loadEnvFile(resolve(workspaceRoot, ".env"));

const e2eDatabaseUrl = requireTestDatabaseUrl(process.env.POSTGRES_TEST_URL);

await prepareE2EDatabase(e2eDatabaseUrl);

console.log(`Running API e2e tests against ${redactDatabaseUrl(e2eDatabaseUrl)}`);

const result = spawnSync(
  process.execPath,
  [
    "--import",
    "tsx",
    "--test",
    "--test-concurrency=1",
    "src/**/*.e2e-spec.ts",
  ],
  {
    cwd: apiRoot,
    env: {
      ...process.env,
      NODE_ENV: "test",
      POSTGRES_TEST_URL: e2eDatabaseUrl,
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

async function prepareE2EDatabase(connectionString) {
  const client = new pg.Client({
    connectionString,
  });

  try {
    await client.connect();
    console.log(`Prepared API E2E database ${redactDatabaseUrl(connectionString)}`);
    await client.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    await client.query('CREATE EXTENSION IF NOT EXISTS "pg_trgm"');
  } catch (error) {
    console.error(
      `Unable to prepare API E2E database ${redactDatabaseUrl(connectionString)}.`,
    );
    console.error("Set POSTGRES_TEST_URL to a dedicated, disposable remote test database. API E2E resets its public schema; never use a production URL.");
    console.error(error);
    process.exit(1);
  } finally {
    await client.end().catch(() => undefined);
  }
}

function requireTestDatabaseUrl(value) {
  const connectionString = value?.trim();
  if (!connectionString) {
    throw new Error(
      "POSTGRES_TEST_URL is required for API E2E. It must point to a dedicated, disposable remote test database.",
    );
  }
  try {
    const url = new URL(connectionString);
    if (url.protocol !== "postgresql:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error("POSTGRES_TEST_URL must be a valid postgresql:// URL");
  }
  return connectionString;
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
