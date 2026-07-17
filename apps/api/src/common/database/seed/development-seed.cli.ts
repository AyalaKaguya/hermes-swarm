import "reflect-metadata";
import { pathToFileURL } from "node:url";
import { DataSource, type DataSourceOptions } from "typeorm";
import migrationDataSource from "../migration-data-source.js";
import { databaseRuntimeConfig } from "../../config/runtime-config.js";
import { TenantContextService } from "../tenant-context.service.js";
import {
  DevelopmentSeedService,
  type DevelopmentSeedConfig,
} from "./development-seed.service.js";

export function readDevelopmentSeedConfig(
  env: NodeJS.ProcessEnv,
): DevelopmentSeedConfig {
  return {
    organizationName: optionalText(env.DEV_SEED_ORGANIZATION_NAME, "Hermes Dev"),
    organizationSlug: normalizeSlug(
      optionalText(env.DEV_SEED_ORGANIZATION_SLUG, "hermes-dev"),
    ),
    ownerDisplayName: optionalText(env.DEV_SEED_OWNER_NAME, "Tenant Owner"),
    ownerEmail: normalizeEmail(
      optionalText(env.DEV_SEED_OWNER_EMAIL, "owner@hermes.local"),
    ),
    ownerPassword: requiredPassword(env.DEV_SEED_OWNER_PASSWORD, "DEV_SEED_OWNER_PASSWORD"),
    platformAdminDisplayName: optionalText(
      env.DEV_SEED_PLATFORM_ADMIN_NAME,
      "Platform Admin",
    ),
    platformAdminEmail: normalizeEmail(
      optionalText(env.DEV_SEED_PLATFORM_ADMIN_EMAIL, "admin@hermes.local"),
    ),
    platformAdminPassword: requiredPassword(
      env.DEV_SEED_PLATFORM_ADMIN_PASSWORD,
      "DEV_SEED_PLATFORM_ADMIN_PASSWORD",
    ),
    tenantName: optionalText(env.DEV_SEED_TENANT_NAME, "Hermes Development"),
    tenantSlug: normalizeSlug(
      optionalText(env.DEV_SEED_TENANT_SLUG, "hermes-dev"),
    ),
  };
}

export async function runDevelopmentSeed() {
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ALLOW_PRODUCTION_SEED !== "true"
  ) {
    throw new Error("Development seed is disabled in production");
  }
  const config = readDevelopmentSeedConfig(process.env);
  const database = databaseRuntimeConfig();
  const tenantDataSource = createSeedDataSource(database.tenantUrl);
  const platformDataSource = createSeedDataSource(database.platformUrl);
  try {
    await Promise.all([
      tenantDataSource.initialize(),
      platformDataSource.initialize(),
    ]);
    const result = await new DevelopmentSeedService(
      platformDataSource,
      tenantDataSource,
      new TenantContextService(),
    ).run(config);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await Promise.all([
      tenantDataSource.isInitialized ? tenantDataSource.destroy() : undefined,
      platformDataSource.isInitialized ? platformDataSource.destroy() : undefined,
    ]);
  }
}

function createSeedDataSource(url: string) {
  return new DataSource({
    ...migrationDataSource.options,
    migrations: [],
    synchronize: false,
    url,
  } as unknown as DataSourceOptions);
}

function requiredPassword(value: string | undefined, name: string) {
  const password = value?.trim();
  if (!password) throw new Error(`${name} is required`);
  if (password.length < 8) throw new Error(`${name} must be at least 8 characters`);
  return password;
}

function optionalText(value: string | undefined, fallback: string) {
  return value?.trim() || fallback;
}

function normalizeEmail(value: string) {
  const email = value.toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error(`Invalid seed email: ${value}`);
  }
  return email;
}

function normalizeSlug(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new Error(`Invalid seed slug: ${value}`);
  return slug;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runDevelopmentSeed();
}
