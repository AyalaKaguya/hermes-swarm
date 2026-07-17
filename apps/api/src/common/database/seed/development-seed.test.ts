import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readDevelopmentSeedConfig } from "./development-seed.cli.js";
import { buildSeedPermissionCatalog } from "./seed-permission-catalog.js";
import { DEVELOPMENT_FIXTURE_SCENARIOS } from "./development-seed-fixtures.js";

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
    assert.equal(catalog.some((item) => item.scope === "department"), false);
    assert.ok(catalog.some((item) => item.source === "navigation"));
    assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
  });

  it("grants tenant users the personal integration token contract", () => {
    const catalog = buildSeedPermissionCatalog();
    const operations = ["capabilities", "list", "create", "revoke"];

    for (const operation of operations) {
      const definition = catalog.find(
        (item) =>
          item.id ===
          `integration_token.personal_api_token.${operation}:own`,
      );
      assert.deepEqual(definition?.defaultRoles, [
        "tenant-owner",
        "tenant-admin",
        "tenant-member",
      ]);
    }
  });

  it("grants tenant roles the organization directory contract", () => {
    const catalog = buildSeedPermissionCatalog();
    const expectedRoles = new Map([
      ["list", ["tenant-owner", "tenant-admin", "tenant-member"]],
      ["create", ["tenant-owner", "tenant-admin"]],
      ["delete", ["tenant-owner", "tenant-admin"]],
    ]);

    for (const [operation, roles] of expectedRoles) {
      const definition = catalog.find(
        (item) =>
          item.id === `organization.tenant_organization.${operation}:tenant`,
      );
      assert.deepEqual(definition?.defaultRoles, roles);
    }
  });

  it("grants the tenant owner every tenant-scoped operation", () => {
    const tenantDefinitions = buildSeedPermissionCatalog().filter(
      (item) => item.scope === "tenant",
    );

    assert.ok(tenantDefinitions.length > 0);
    assert.deepEqual(
      tenantDefinitions
        .filter((item) => !item.defaultRoles.includes("tenant-owner"))
        .map((item) => item.id),
      [],
    );
    assert.ok(
      tenantDefinitions.some(
        (item) => item.id === "user.tenant_user.delete:tenant",
      ),
    );
    assert.ok(
      tenantDefinitions.some(
        (item) => item.id === "mail.tenant_mail.delete_template:tenant",
      ),
    );
  });

  it("grants ticket participants own-resource conversation permissions", () => {
    const catalog = buildSeedPermissionCatalog();
    for (const operation of ["view", "list_messages", "send_message", "close", "mark_read"]) {
      const definition = catalog.find(
        (item) => item.id === `ticket.conversation.${operation}:own`,
      );
      assert.ok(definition?.defaultRoles.includes("tenant-owner"));
      assert.ok(definition?.defaultRoles.includes("tenant-member"));
      assert.equal(definition?.defaultRoles.includes("owner"), false);
      assert.equal(definition?.defaultRoles.includes("member"), false);
    }
  });

  it("covers the default organization business states without unsupported values", () => {
    assert.deepEqual(DEVELOPMENT_FIXTURE_SCENARIOS.ticketStatuses, [
      "open",
      "closed",
      "archived",
    ]);
    assert.deepEqual(DEVELOPMENT_FIXTURE_SCENARIOS.organizationTree, [
      "root",
      "engineering",
      "support",
    ]);
    assert.ok(DEVELOPMENT_FIXTURE_SCENARIOS.userStates.includes("disabled"));
    assert.ok(
      DEVELOPMENT_FIXTURE_SCENARIOS.userStates.includes("multi-organization"),
    );
  });

  it("uses only inactive integration token fixtures", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("./development-seed-fixtures.ts", import.meta.url), "utf8"),
    );
    assert.doesNotMatch(source, /admin123456/);
    assert.match(source, /ensureInactiveToken/);
    assert.match(source, /state === "revoked"/);
    assert.doesNotMatch(source, /tokenSecret|plaintextToken|rawToken/);
  });
});
