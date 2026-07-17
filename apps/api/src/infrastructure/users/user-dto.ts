import type { Role, User } from "@hermes-swarm/core";

export function toUserDto(user: User, tenantRole: Role | null = null) {
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
    tenantRole: tenantRole
      ? {
          color: tenantRole.color,
          description: tenantRole.description,
          displayName: tenantRole.displayName,
          id: tenantRole.id,
          isSystem: tenantRole.isSystem,
          label: tenantRole.label,
          name: tenantRole.name,
          scope: tenantRole.scope,
        }
      : null,
    type: user.type,
    updatedAt: user.updatedAt,
    username: user.username,
  };
}
