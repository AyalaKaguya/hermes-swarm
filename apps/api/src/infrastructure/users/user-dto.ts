import type {
  Account,
  Role,
  RolePermission,
  Workspace,
  WorkspaceMembership,
} from "@hermes-swarm/core";

export function toAccountDto(user: Account) {
  return {
    avatarUrl: user.avatarUrl,
    createdAt: user.createdAt,
    displayName: user.displayName,
    email: user.email,
    emailVerified: user.emailVerified,
    firstName: user.firstName,
    id: user.id,
    imageUrl: user.imageUrl,
    lastName: user.lastName,
    mobile: user.mobile,
    nickname: user.nickname,
    preferredLanguage: user.preferredLanguage,
    status: user.status,
    timeZone: user.timeZone,
    type: user.type,
    updatedAt: user.updatedAt,
    username: user.username,
  };
}

export function toUserDto(user: Account, workspaceRole: Role | null = null) {
  return {
    ...toAccountDto(user),
    workspaceRole: workspaceRole ? toRoleDto(workspaceRole) : null,
  };
}

export function toWorkspaceMemberDto(
  membership: WorkspaceMembership,
  account: Account,
  role: Role | null = membership.role ?? null,
) {
  return {
    account: toAccountDto(account),
    membershipId: membership.id,
    removedAt: membership.removedAt,
    role: role ? toRoleDto(role) : null,
    status: membership.status,
  };
}

export function toRoleDto(role: Role, permissions?: RolePermission[]) {
  const result = {
    color: role.color,
    description: role.description,
    displayName: role.displayName,
    id: role.id,
    isSystem: role.isSystem,
    label: role.label,
    name: role.name,
    scope: role.scope,
  };
  return permissions === undefined
    ? result
    : {
        ...result,
        permissions: permissions.map((permission) => ({
          enabled: permission.enabled,
          id: permission.id,
          permission: permission.permission,
          permissionId: permission.permissionId,
          roleId: permission.roleId,
        })),
      };
}

export function toWorkspaceDto(workspace: Workspace) {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    status: workspace.status,
  };
}
