import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hasPageAccess,
  hasPermission,
  mergePermissionCodes,
} from "./access-control";
import type { RolePermission } from "./admin-api";
import type { ResolvedSession } from "./session";

const principal = (permissions: string[]): ResolvedSession =>
  ({ permissions, principalType: "tenant" }) as ResolvedSession;

const rolePermission = (
  permission: string,
  roleId = "role-test",
): RolePermission => ({
  enabled: true,
  id: `${roleId}-${permission}`,
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
            rolePermission(permission, "role-org"),
          ),
        },
        status: "active",
      },
    ],
    organization: { id: organizationId },
    permissions: [],
    principalType: "tenant",
  }) as unknown as ResolvedSession;

const platformPrincipal = (permissions: string[]): ResolvedSession =>
  ({
    permissions,
    platformUser: {
      roles: [{
        name: "platform-admin",
        permissions: permissions.map((permission) =>
          rolePermission(permission, "role-platform"),
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

  it("merges enabled tenant role permissions into the effective session", () => {
    assert.deepEqual(
      mergePermissionCodes(
        ["page.settings.tenant.access:tenant"],
        {
          permissions: [
            rolePermission("setting.tenant_config.list:tenant"),
            rolePermission("setting.tenant_config.save:tenant"),
            {
              ...rolePermission("setting.tenant_config.delete:tenant"),
              enabled: false,
            },
          ],
        },
      ),
      [
        "page.settings.tenant.access:tenant",
        "setting.tenant_config.list:tenant",
        "setting.tenant_config.save:tenant",
      ],
    );
  });

  it("checks page access through page definition permissions", () => {
    assert.equal(
      hasPageAccess(
        principal(["page.settings.workspace-access.access:tenant"]),
        "settings.workspace-access",
      ),
      true,
    );
    assert.equal(hasPageAccess(principal([]), "settings.workspace-access"), false);
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

  it("checks personal pages without accepting platform principals", () => {
    const permission = "page.settings.api-tokens.access:own";

    assert.equal(
      hasPageAccess(principal([permission]), "settings.api-tokens"),
      true,
    );
    assert.equal(
      hasPageAccess(platformPrincipal([permission]), "settings.api-tokens"),
      false,
    );
  });
});
