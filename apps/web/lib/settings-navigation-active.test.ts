import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveSettingsNavigationKey } from "./settings-navigation-active";

const items = [
  { href: "/settings/organization", key: "organization.general" },
  { href: "/settings/organization?tab=members", key: "organization.members" },
  { href: "/settings/organizations", key: "organizations.directory" },
];

describe("settings navigation active item", () => {
  it("selects the organization general item on its exact path", () => {
    assert.equal(
      resolveActiveSettingsNavigationKey(
        items,
        "/settings/organization",
        new URLSearchParams(),
      ),
      "organization.general",
    );
  });

  it("selects a query-specific organization item before the general item", () => {
    assert.equal(
      resolveActiveSettingsNavigationKey(
        items,
        "/settings/organization",
        new URLSearchParams("tab=members"),
      ),
      "organization.members",
    );
  });

  it("keeps the organization directory active on an organization detail route", () => {
    assert.equal(
      resolveActiveSettingsNavigationKey(
        items,
        "/settings/organizations/org-1",
        new URLSearchParams(),
      ),
      "organizations.directory",
    );
  });
});
