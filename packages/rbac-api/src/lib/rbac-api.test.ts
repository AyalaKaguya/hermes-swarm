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
      matchRoutePattern(
        "/settings/organizations/:organizationId",
        "/settings/organizations/org-123",
      ),
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
      getPageAccessPermissionId("settings.workspace-access", "tenant"),
      "page.settings.workspace-access.access:tenant",
    );
  });
});

describe("page access definitions", () => {
  it("hydrates definitions with their permission ids", () => {
    const definition = getPageAccessDefinition("settings.users");

    assert.equal(definition?.permission, "page.settings.users.access:tenant");
    assert.deepEqual(definition?.defaultRoles, ["tenant-owner", "tenant-admin"]);
  });

  it("exposes role management as tenant governance", () => {
    const definition = getPageAccessDefinition("settings.workspace-access");

    assert.equal(
      definition?.permission,
      "page.settings.workspace-access.access:tenant",
    );
    assert.equal(definition?.scope, "tenant");
    assert.equal(definition?.section, "tenant");
    assert.deepEqual(definition?.defaultRoles, ["tenant-owner", "tenant-admin"]);
  });

  it("returns null for unknown page keys", () => {
    assert.equal(getPageAccessDefinition("missing.page"), null);
  });

  it("does not expose the removed external notification destination page", () => {
    assert.equal(
      getPageAccessDefinition("settings.notification-destinations"),
      null,
    );
    assert.equal(
      findPageAccessDefinitionByPath("/settings/notification-destinations"),
      null,
    );
  });

  it("finds the first page definition for a route", () => {
    assert.equal(
      findPageAccessDefinitionByPath("/settings/organization")?.key,
      "settings.organization",
    );
    assert.equal(
      findPageAccessDefinitionByPath("/settings/organizations")?.key,
      "settings.organizations",
    );
    assert.equal(
      findPageAccessDefinitionByPath("/settings/organizations/org-123")?.key,
      "settings.organizations",
    );
  });

  it("keeps tenant organization detail routes single-owned", () => {
    assert.deepEqual(
      findPageAccessDefinitionsByPath("/settings/organizations/org-123").map(
        (definition) => definition.key,
      ),
      ["settings.organizations"],
    );
  });

  it("uses own scope for account-created integration tokens", () => {
    const definition = getPageAccessDefinition("settings.api-tokens");

    assert.equal(definition?.scope, "own");
    assert.equal(
      definition?.permission,
      "page.settings.api-tokens.access:own",
    );
    assert.equal(getPageAccessDefinition("settings.platform-integrations"), null);
  });

  it("defines explicit workspace governance ownership", () => {
    const tenant = getPageAccessDefinition("settings.tenant");
    const users = getPageAccessDefinition("settings.users");
    const invites = getPageAccessDefinition("settings.invites");

    assert.equal(tenant?.scope, "tenant");
    assert.equal(tenant?.href, "/settings/tenant");
    assert.equal(tenant?.section, "tenant");
    assert.equal(tenant?.sectionLabel, "工作空间");
    assert.equal(users?.scope, "tenant");
    assert.equal(invites?.scope, "tenant");
    assert.equal(
      getPageAccessDefinition("settings.organizations")?.section,
      "tenant",
    );
    assert.deepEqual(
      findPageAccessDefinitionsByPath("/settings/users").map(
        (definition) => definition.key,
      ),
      ["settings.users"],
    );
    assert.equal(getPageAccessDefinition("settings.organization.departments"), null);
    assert.equal(
      getPageAccessDefinition("settings.organization.members")?.scope,
      "organization",
    );
    assert.equal(
      getPageAccessDefinition("settings.organization.roles")?.scope,
      "organization",
    );
  });
});
