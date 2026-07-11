import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readDevelopmentSeedConfig } from "./development-seed.cli.js";
import { buildSeedPermissionCatalog } from "./seed-permission-catalog.js";

describe("development seed contract", () => {
  it("requires explicit passwords for both identity planes", () => {
    assert.throws(
      () => readDevelopmentSeedConfig({}),
      /DEV_SEED_OWNER_PASSWORD is required/,
    );
    assert.throws(
      () =>
        readDevelopmentSeedConfig({
          DEV_SEED_OWNER_PASSWORD: "owner-pass",
        }),
      /DEV_SEED_PLATFORM_ADMIN_PASSWORD is required/,
    );
  });

  it("normalizes the repeatable development identities", () => {
    const config = readDevelopmentSeedConfig({
      DEV_SEED_ORGANIZATION_SLUG: " Main Office ",
      DEV_SEED_OWNER_EMAIL: "OWNER@EXAMPLE.COM",
      DEV_SEED_OWNER_PASSWORD: "owner-pass",
      DEV_SEED_PLATFORM_ADMIN_EMAIL: "ADMIN@EXAMPLE.COM",
      DEV_SEED_PLATFORM_ADMIN_PASSWORD: "platform-pass",
      DEV_SEED_TENANT_SLUG: "Demo Tenant",
    });
    assert.equal(config.organizationSlug, "main-office");
    assert.equal(config.ownerEmail, "owner@example.com");
    assert.equal(config.platformAdminEmail, "admin@example.com");
    assert.equal(config.tenantSlug, "demo-tenant");
  });

  it("rebuilds platform, tenant, organization and navigation permissions", () => {
    const catalog = buildSeedPermissionCatalog();
    assert.ok(catalog.some((item) => item.scope === "platform"));
    assert.ok(catalog.some((item) => item.scope === "tenant"));
    assert.ok(catalog.some((item) => item.scope === "organization"));
    assert.ok(catalog.some((item) => item.scope === "department"));
    assert.ok(catalog.some((item) => item.source === "navigation"));
    assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
  });
});
