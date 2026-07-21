import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveActiveSettingsNavigationKey } from "./settings-navigation-active";

const items = [
  { href: "/settings/workspace", key: "workspace.general" },
  { href: "/settings/workspace/members", key: "workspace.members" },
  { href: "/settings/workspace/access", key: "workspace.access" },
];

describe("settings navigation active item", () => {
  it("selects the workspace item on its exact path", () => {
    assert.equal(
      resolveActiveSettingsNavigationKey(
        items,
        "/settings/workspace",
        new URLSearchParams(),
      ),
      "workspace.general",
    );
  });

  it("selects the longest matching nested workspace route", () => {
    assert.equal(
      resolveActiveSettingsNavigationKey(
        items,
        "/settings/workspace/members",
        new URLSearchParams(),
      ),
      "workspace.members",
    );
  });
});
