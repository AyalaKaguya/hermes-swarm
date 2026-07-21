import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INFRASTRUCTURE_NAV_SECTIONS } from "../components/infrastructure-navigation";

describe("settings information architecture", () => {
  it("keeps platform configuration out of workspace navigation", () => {
    assert.deepEqual(
      INFRASTRUCTURE_NAV_SECTIONS.map((section) => section.key),
      ["personal", "workspace"],
    );

    const workspace = INFRASTRUCTURE_NAV_SECTIONS.find(
      (section) => section.key === "workspace",
    );
    assert.equal(workspace?.label, "工作空间");
    assert.deepEqual(
      workspace?.items.map((item) => item.key),
      [
        "settings.workspace",
        "settings.workspace.members",
        "settings.invites",
        "settings.email-templates",
        "settings.workspace-access",
        "settings.audit-logs",
      ],
    );
    const personal = INFRASTRUCTURE_NAV_SECTIONS.find(
      (section) => section.key === "personal",
    );
    assert.deepEqual(
      personal?.items.map((item) => item.key),
      ["settings.account", "settings.sessions", "settings.api-tokens"],
    );
    assert.equal(
      INFRASTRUCTURE_NAV_SECTIONS.flatMap((section) => section.items)
        .some((item) => item.pageKey.startsWith("settings.platform")),
      false,
    );
  });
});
