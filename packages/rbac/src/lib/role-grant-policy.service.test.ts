import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RoleGrantPolicyService } from "./role-grant-policy.service.js";

describe("RoleGrantPolicyService", () => {
  const service = new RoleGrantPolicyService();
  const actor = {
    principalType: "workspace" as const,
    workspaceId: "workspace-1",
    userId: "actor-1",
  };

  it("rejects protected roles unless the actor already holds that role", () => {
    assert.throws(
      () =>
        service.assertCanGrant({
          actor,
          actorPermissionCodes: ["user.role.replace:workspace"],
          actorRoleNames: ["workspace-admin"],
          scope: "workspace",
          targetRole: { id: "owner-role", name: "workspace-owner" },
          targetUserId: "user-2",
        }),
      (error: any) =>
        error?.getResponse?.().code === "ROLE_GRANT_PROTECTED" &&
        error?.getStatus?.() === 403,
    );
  });

  it("allows an owner to grant the matching protected role", () => {
    assert.doesNotThrow(() =>
      service.assertCanGrant({
        actor,
        actorPermissionCodes: [],
        actorRoleNames: ["workspace-owner"],
        scope: "workspace",
        targetRole: { id: "owner-role", name: "workspace-owner" },
        targetUserId: "user-2",
      }),
    );
  });

  it("rejects permission sets that exceed the actor's live permissions", () => {
    assert.throws(
      () =>
        service.assertCanReplacePermissions(
          ["user.list:workspace"],
          ["user.list:workspace", "user.delete:workspace"],
        ),
      (error: any) =>
        error?.getResponse?.().code === "PERMISSION_GRANT_EXCEEDS_ACTOR",
    );
  });

  it("returns the self-escalation code when assigning excessive permissions to self", () => {
    assert.throws(
      () =>
        service.assertCanGrant({
          actor,
          actorPermissionCodes: ["user.list:workspace"],
          actorRoleNames: ["workspace-admin"],
          scope: "workspace",
          targetRole: {
            id: "custom-role",
            name: "custom",
            permissionCodes: ["user.delete:workspace"],
          },
          targetUserId: actor.userId,
        }),
      (error: any) =>
        error?.getResponse?.().code === "ROLE_GRANT_SELF_ESCALATION",
    );
  });
});
