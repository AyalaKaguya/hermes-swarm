import { ForbiddenException, Injectable } from "@nestjs/common";
import type { AccessAuthSession } from "./access.types.js";

export type RoleGrantScope = "organization" | "platform" | "tenant";

export type RoleDescriptor = {
  id: string;
  name: string;
  permissionCodes?: string[];
};

export type RoleGrantRequest = {
  actor: Pick<AccessAuthSession, "principalType" | "tenantId" | "userId">;
  actorPermissionCodes: string[];
  actorRoleNames: string[];
  scope: RoleGrantScope;
  targetRole: RoleDescriptor;
  targetUserId?: string;
};

@Injectable()
export class RoleGrantPolicyService {
  assertCanGrant(request: RoleGrantRequest) {
    const protectedRole = protectedRoleName(request.scope);
    if (
      request.targetRole.name === protectedRole &&
      !request.actorRoleNames.includes(protectedRole)
    ) {
      throw grantDenied(
        "ROLE_GRANT_PROTECTED",
        `只有当前 ${protectedRole} 可以授予该受保护角色`,
      );
    }
    this.assertPermissionSubset(
      request.actorPermissionCodes,
      request.targetRole.permissionCodes ?? [],
      request.targetUserId === request.actor.userId,
    );
  }

  assertCanReplacePermissions(
    actorPermissionCodes: string[],
    requestedPermissionCodes: string[],
  ) {
    this.assertPermissionSubset(
      actorPermissionCodes,
      requestedPermissionCodes,
      false,
    );
  }

  private assertPermissionSubset(
    actorPermissionCodes: string[],
    requestedPermissionCodes: string[],
    selfAssignment: boolean,
  ) {
    const actorPermissions = new Set(actorPermissionCodes);
    const excessive = requestedPermissionCodes.filter(
      (permission) => !actorPermissions.has(permission),
    );
    if (!excessive.length) return;
    throw grantDenied(
      selfAssignment
        ? "ROLE_GRANT_SELF_ESCALATION"
        : "PERMISSION_GRANT_EXCEEDS_ACTOR",
      "不能授予操作者当前未拥有的权限",
    );
  }
}

function protectedRoleName(scope: RoleGrantScope) {
  if (scope === "platform") return "platform-admin";
  if (scope === "tenant") return "tenant-owner";
  return "owner";
}

function grantDenied(code: string, message: string) {
  return new ForbiddenException({ code, message, statusCode: 403 });
}
