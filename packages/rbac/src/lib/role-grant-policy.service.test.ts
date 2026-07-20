import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { RoleGrantPolicyService } from "./role-grant-policy.service.js";

describe("RoleGrantPolicyService", () => {
  const service = new RoleGrantPolicyService();
  const actor = {
    principalType: "tenant" as const,
    tenantId: "tenant-1",
    userId: "actor-1",
  };

  it("rejects protected roles unless the actor already holds that role", () => {
    assert.throws(
      () =>
        service.assertCanGrant({
          actor,
          actorPermissionCodes: ["user.role.replace:tenant"],
          actorRoleNames: ["tenant-admin"],
          scope: "tenant",
          targetRole: { id: "owner-role", name: "tenant-owner" },
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
        actorRoleNames: ["tenant-owner"],
        scope: "tenant",
        targetRole: { id: "owner-role", name: "tenant-owner" },
        targetUserId: "user-2",
      }),
    );
  });

  it("rejects permission sets that exceed the actor's live permissions", () => {
    assert.throws(
      () =>
        service.assertCanReplacePermissions(
          ["user.list:tenant"],
          ["user.list:tenant", "user.delete:tenant"],
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
          actorPermissionCodes: ["user.list:tenant"],
          actorRoleNames: ["tenant-admin"],
          scope: "tenant",
          targetRole: {
            id: "custom-role",
            name: "custom",
            permissionCodes: ["user.delete:tenant"],
          },
          targetUserId: actor.userId,
        }),
      (error: any) =>
        error?.getResponse?.().code === "ROLE_GRANT_SELF_ESCALATION",
    );
  });
});
