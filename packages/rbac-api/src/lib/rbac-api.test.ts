import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findPageAccessDefinitionByPath,
  findPageAccessDefinitionsByPath,
  getOperationPermissionId,
  getPageAccessDefinition,
  getPageAccessPermissionId,
  matchRoutePattern,
} from "../index.js";

describe("route pattern matching", () => {
  it("matches literal routes with or without surrounding slashes", () => {
    assert.equal(matchRoutePattern("/settings/account", "settings/account/"), true);
  });

  it("matches parameterized segments at the same depth", () => {
    assert.equal(
      matchRoutePattern("/tickets/:ticketId", "/tickets/ticket-123"),
      true,
    );
  });

  it("rejects different route depths and literal segment mismatches", () => {
    assert.equal(matchRoutePattern("/settings/:section", "/settings"), false);
    assert.equal(matchRoutePattern("/settings/roles", "/settings/groups"), false);
  });
});

describe("permission keys", () => {
  it("formats operation permission identifiers", () => {
    assert.equal(
      getOperationPermissionId("user", "profile", "update", "own"),
      "user.profile.update:own",
    );
  });

  it("formats page access permission identifiers", () => {
    assert.equal(
      getPageAccessPermissionId("settings.workspace-access", "workspace"),
      "page.settings.workspace-access.access:workspace",
    );
  });
});

describe("page access definitions", () => {
  it("hydrates workspace member management with its permission id", () => {
    const definition = getPageAccessDefinition("settings.workspace.members");

    assert.equal(
      definition?.permission,
      "page.settings.workspace.members.access:workspace",
    );
    assert.equal(definition?.href, "/settings/workspace/members");
    assert.deepEqual(definition?.defaultRoles, [
      "workspace-owner",
      "workspace-admin",
    ]);
  });

  it("exposes role management as workspace governance", () => {
    const definition = getPageAccessDefinition("settings.workspace-access");

    assert.equal(
      definition?.permission,
      "page.settings.workspace-access.access:workspace",
    );
    assert.equal(definition?.scope, "workspace");
    assert.equal(definition?.section, "workspace");
    assert.deepEqual(definition?.defaultRoles, [
      "workspace-owner",
      "workspace-admin",
    ]);
  });

  it("finds canonical workspace routes without legacy aliases", () => {
    assert.equal(
      findPageAccessDefinitionByPath("/settings/workspace")?.key,
      "settings.workspace",
    );
    assert.equal(
      findPageAccessDefinitionByPath("/settings/workspace/members")?.key,
      "settings.workspace.members",
    );
    assert.deepEqual(
      findPageAccessDefinitionsByPath("/settings/workspace/access").map(
        (definition) => definition.key,
      ),
      ["settings.workspace-access"],
    );
  });

  it("uses own scope for account-created integration tokens", () => {
    const definition = getPageAccessDefinition("settings.api-tokens");

    assert.equal(definition?.scope, "own");
    assert.equal(definition?.permission, "page.settings.api-tokens.access:own");
    assert.equal(getPageAccessDefinition("settings.platform-integrations"), null);
  });

  it("defines scope-isolated workspace and platform audit pages", () => {
    const workspaceAudit = getPageAccessDefinition("settings.audit-logs");
    const platformAudit = getPageAccessDefinition("platform.audit");

    assert.equal(workspaceAudit?.href, "/settings/audit-logs");
    assert.equal(workspaceAudit?.scope, "workspace");
    assert.equal(platformAudit?.href, "/platform");
    assert.equal(platformAudit?.scope, "platform");
    assert.deepEqual(
      findPageAccessDefinitionsByPath("/platform/workspaces").map(
        (item) => item.key,
      ),
      ["platform.workspaces"],
    );
  });

  it("returns null for unknown page keys and removed pages", () => {
    assert.equal(getPageAccessDefinition("missing.page"), null);
    assert.equal(
      getPageAccessDefinition("settings.notification-destinations"),
      null,
    );
  });
});
