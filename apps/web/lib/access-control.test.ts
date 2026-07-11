import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPageAccess, hasPermission } from "./access-control";
import type { RolePermission } from "./admin-api";
import type { ResolvedSession } from "./session";

const principal = (permissions: string[]): ResolvedSession =>
  ({ permissions, principalType: "tenant" }) as ResolvedSession;

const rolePermission = (
  permission: string,
  roleId = "role-test",
  organizationId: string | null = "org-1",
): RolePermission => ({
  enabled: true,
  id: `${roleId}-${permission}`,
  organizationId,
  permission,
  roleId,
});

const organizationPrincipal = (
  permissions: string[],
  organizationId = "org-1",
): ResolvedSession =>
  ({
    memberships: [
      {
        organizationId,
        role: {
          permissions: permissions.map((permission) =>
            rolePermission(permission, "role-org", organizationId),
          ),
        },
        status: "active",
      },
    ],
    organization: { id: organizationId },
    permissions,
    principalType: "tenant",
  }) as ResolvedSession;

const platformPrincipal = (permissions: string[]): ResolvedSession =>
  ({
    permissions,
    platformUser: {
      roles: [{
        name: "platform-admin",
        permissions: permissions.map((permission) =>
          rolePermission(permission, "role-platform", null),
        ),
      }],
    },
    principalType: "platform",
  }) as ResolvedSession;

describe("web access control", () => {
  it("denies missing principals", () => {
    assert.equal(hasPermission(null, "page.settings.account.access:own"), false);
  });

  it("supports any and all permission modes", () => {
    const user = principal(["alpha", "beta"]);

    assert.equal(hasPermission(user, ["missing", "alpha"]), true);
    assert.equal(hasPermission(user, ["alpha", "beta"], { mode: "all" }), true);
    assert.equal(hasPermission(user, ["alpha", "missing"], { mode: "all" }), false);
  });

  it("allows empty permission requirements for an authenticated principal", () => {
    assert.equal(hasPermission(principal([]), []), true);
  });

  it("checks page access through page definition permissions", () => {
    assert.equal(
      hasPageAccess(
        organizationPrincipal(["page.settings.roles.access:organization"]),
        "settings.roles",
      ),
      true,
    );
    assert.equal(hasPageAccess(principal([]), "settings.roles"), false);
    assert.equal(hasPageAccess(principal([]), "missing.page"), false);
  });

  it("uses route organization context for organization-scoped pages", () => {
    const user = organizationPrincipal(
      ["page.settings.organization.access:organization"],
      "org-1",
    );

    assert.equal(
      hasPageAccess(user, "settings.organization", {
        organizationId: "org-1",
      }),
      true,
    );
    assert.equal(
      hasPageAccess(user, "settings.organization", {
        organizationId: "org-2",
      }),
      false,
    );
  });

  it("checks platform pages against PlatformUser role permissions", () => {
    assert.equal(
      hasPageAccess(
        platformPrincipal(["page.settings.platform.access:platform"]),
        "settings.platform",
      ),
      true,
    );
    assert.equal(
      hasPageAccess(
        organizationPrincipal(["page.settings.platform.access:platform"]),
        "settings.platform",
      ),
      false,
    );
  });

  it("checks tenant pages without accepting platform principals", () => {
    const permission = "page.settings.integrations.access:tenant";

    assert.equal(
      hasPageAccess(principal([permission]), "settings.integrations"),
      true,
    );
    assert.equal(
      hasPageAccess(platformPrincipal([permission]), "settings.integrations"),
      false,
    );
  });
});
