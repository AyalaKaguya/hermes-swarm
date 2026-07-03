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
      getPageAccessPermissionId("settings.roles", "organization"),
      "page.settings.roles.access:organization",
    );
  });
});

describe("page access definitions", () => {
  it("hydrates definitions with their permission ids", () => {
    const definition = getPageAccessDefinition("settings.custom-smtp");

    assert.equal(definition?.permission, "page.settings.custom-smtp.access:organization");
    assert.deepEqual(definition?.defaultRoles, ["owner", "admin"]);
  });

  it("returns null for unknown page keys", () => {
    assert.equal(getPageAccessDefinition("missing.page"), null);
  });

  it("finds the first page definition for a route", () => {
    assert.equal(
      findPageAccessDefinitionByPath("/settings/organizations/org-123")?.key,
      "settings.organization",
    );
  });

  it("returns every matching page definition for overlapping route patterns", () => {
    assert.deepEqual(
      findPageAccessDefinitionsByPath("/settings/organizations/org-123").map(
        (definition) => definition.key,
      ),
      ["settings.organization", "settings.organizations"],
    );
  });
});
