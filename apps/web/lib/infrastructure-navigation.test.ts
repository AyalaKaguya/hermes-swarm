import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { INFRASTRUCTURE_NAV_SECTIONS } from "../components/infrastructure-navigation";

describe("settings information architecture", () => {
  it("keeps platform and organization-local configuration out of tenant navigation", () => {
    assert.deepEqual(
      INFRASTRUCTURE_NAV_SECTIONS.map((section) => section.key),
      ["personal", "tenant", "organization"],
    );

    const tenant = INFRASTRUCTURE_NAV_SECTIONS.find(
      (section) => section.key === "tenant",
    );
    assert.equal(tenant?.label, "工作空间");
    assert.deepEqual(
      tenant?.items.map((item) => item.key),
      [
        "settings.tenant",
        "settings.organizations",
        "settings.users",
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
    const organization = INFRASTRUCTURE_NAV_SECTIONS.find(
      (section) => section.key === "organization",
    );
    assert.deepEqual(
      organization?.items.map((item) => item.key),
      [
        "settings.organization",
        "settings.organization.members",
        "settings.organization.roles",
      ],
    );
    assert.equal(
      INFRASTRUCTURE_NAV_SECTIONS.flatMap((section) => section.items)
        .some((item) => item.pageKey.startsWith("settings.platform")),
      false,
    );
  });
});
