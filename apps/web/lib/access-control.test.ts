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
  ({ permissions, principalType: "workspace" }) as ResolvedSession;

const rolePermission = (
  permission: string,
  roleId = "role-test",
): RolePermission => ({
  enabled: true,
  id: `${roleId}-${permission}`,
  permission,
  roleId,
});

const platformPrincipal = (permissions: string[]): ResolvedSession =>
  ({
    permissions,
    principalType: "platform",
    role: null,
    user: { id: "account-platform" },
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

  it("merges enabled workspace role permissions into the effective session", () => {
    assert.deepEqual(
      mergePermissionCodes(
        ["page.settings.workspace.access:workspace"],
        {
          permissions: [
            rolePermission("setting.workspace_config.list:workspace"),
            rolePermission("setting.workspace_config.save:workspace"),
            {
              ...rolePermission("setting.workspace_config.delete:workspace"),
              enabled: false,
            },
          ],
        },
      ),
      [
        "page.settings.workspace.access:workspace",
        "setting.workspace_config.list:workspace",
        "setting.workspace_config.save:workspace",
      ],
    );
  });

  it("checks page access through page definition permissions", () => {
    assert.equal(
      hasPageAccess(
        principal(["page.settings.workspace-access.access:workspace"]),
        "settings.workspace-access",
      ),
      true,
    );
    assert.equal(hasPageAccess(principal([]), "settings.workspace-access"), false);
    assert.equal(hasPageAccess(principal([]), "missing.page"), false);
  });

  it("checks platform pages against resolved platform permissions", () => {
    assert.equal(
      hasPageAccess(
        platformPrincipal(["page.settings.platform.access:platform"]),
        "settings.platform",
      ),
      true,
    );
    assert.equal(
      hasPageAccess(
        principal(["page.settings.platform.access:platform"]),
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
