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
      () => readDevelopmentSeedConfig({ DEV_SEED_OWNER_PASSWORD: "owner-pass" }),
      /DEV_SEED_PLATFORM_ADMIN_PASSWORD is required/,
    );
  });

  it("normalizes the repeatable development identities", () => {
    const config = readDevelopmentSeedConfig({
      DEV_SEED_OWNER_EMAIL: "OWNER@EXAMPLE.COM",
      DEV_SEED_OWNER_PASSWORD: "owner-pass",
      DEV_SEED_PLATFORM_ADMIN_EMAIL: "ADMIN@EXAMPLE.COM",
      DEV_SEED_PLATFORM_ADMIN_PASSWORD: "platform-pass",
      DEV_SEED_WORKSPACE_SLUG: "Demo Workspace",
    });
    assert.equal(config.ownerEmail, "owner@example.com");
    assert.equal(config.platformAdminEmail, "admin@example.com");
    assert.equal(config.workspaceSlug, "demo-workspace");
  });

  it("rebuilds only platform, workspace, own and navigation permissions", () => {
    const catalog = buildSeedPermissionCatalog();
    assert.ok(catalog.some((item) => item.scope === "platform"));
    assert.ok(catalog.some((item) => item.scope === "workspace"));
    assert.ok(catalog.some((item) => item.scope === "own"));
    assert.ok(catalog.some((item) => item.source === "navigation"));
    assert.equal(new Set(catalog.map((item) => item.id)).size, catalog.length);
    assert.deepEqual(
      [...new Set(catalog.map((item) => item.scope))].sort(),
      ["own", "platform", "workspace"],
    );
  });

  it("grants workspace members the personal integration token contract", () => {
    const catalog = buildSeedPermissionCatalog();
    for (const operation of ["capabilities", "list", "create", "revoke"]) {
      const definition = catalog.find(
        (item) =>
          item.id === `integration_token.personal_api_token.${operation}:own`,
      );
      assert.deepEqual(definition?.defaultRoles, [
        "workspace-owner",
        "workspace-admin",
        "workspace-member",
      ]);
    }
  });

  it("grants the workspace owner every workspace-scoped operation", () => {
    const workspaceDefinitions = buildSeedPermissionCatalog().filter(
      (item) => item.scope === "workspace",
    );

    assert.ok(workspaceDefinitions.length > 0);
    assert.deepEqual(
      workspaceDefinitions
        .filter((item) => !item.defaultRoles.includes("workspace-owner"))
        .map((item) => item.id),
      [],
    );
    assert.ok(
      workspaceDefinitions.some(
        (item) => item.id === "membership.workspace_member.remove:workspace",
      ),
    );
    assert.ok(
      workspaceDefinitions.some(
        (item) => item.id === "ticket.conversation.submit:workspace",
      ),
    );
    assert.ok(
      workspaceDefinitions.some(
        (item) => item.id === "ticket.conversation.handle:workspace",
      ),
    );
  });

  it("grants ticket participants own-resource conversation permissions", () => {
    const catalog = buildSeedPermissionCatalog();
    for (const operation of [
      "view",
      "list_messages",
      "send_message",
      "close",
      "mark_read",
    ]) {
      const definition = catalog.find(
        (item) => item.id === `ticket.conversation.${operation}:own`,
      );
      assert.ok(definition?.defaultRoles.includes("workspace-owner"));
      assert.ok(definition?.defaultRoles.includes("workspace-member"));
    }
  });

  it("covers only workspace member and ticket business states", () => {
    assert.deepEqual(DEVELOPMENT_FIXTURE_SCENARIOS.ticketStatuses, [
      "open",
      "closed",
      "archived",
    ]);
    assert.deepEqual(DEVELOPMENT_FIXTURE_SCENARIOS.userStates, [
      "active",
      "disabled",
    ]);
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
