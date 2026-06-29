export const PERMISSION_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
] as const;

export const PERMISSION_SCOPES = [
  "platform",
  "organization",
  "own",
] as const;

export type EntityPermissionAction = (typeof PERMISSION_ACTIONS)[number];
export type EntityPermissionScope = (typeof PERMISSION_SCOPES)[number];

export const SYSTEM_ROLES = [
  { name: "platform-admin", label: "Platform Admin", isSystem: true },
  { name: "owner", label: "Owner", isSystem: true },
  { name: "admin", label: "Admin", isSystem: true },
  { name: "member", label: "Member", isSystem: true },
  { name: "viewer", label: "Viewer", isSystem: true },
] as const;

export type SystemRoleName = (typeof SYSTEM_ROLES)[number]["name"];

export const PLATFORM_ADMIN_ROLE_NAME = "platform-admin";

export const ROLE_RANKS: Record<SystemRoleName, number> = {
  "platform-admin": 500,
  owner: 400,
  admin: 300,
  member: 200,
  viewer: 100,
};

export const CUSTOM_ROLE_RANK = 150;

export function getRoleRank(roleName: string | null | undefined) {
  if (!roleName) return 0;
  return ROLE_RANKS[roleName as SystemRoleName] ?? CUSTOM_ROLE_RANK;
}

export function isPlatformAdminRoleName(roleName: string | null | undefined) {
  return roleName === PLATFORM_ADMIN_ROLE_NAME;
}

export function defaultPermissionsForRole(roleName: string) {
  const allPermissions = DEFAULT_PERMISSION_KEYS;
  const organizationPermissions = DEFAULT_PERMISSION_KEYS.filter(
    (permission) => !permission.endsWith(":platform"),
  );

  if (isPlatformAdminRoleName(roleName)) {
    return allPermissions;
  }

  if (roleName === "owner" || roleName === "admin") {
    return organizationPermissions;
  }

  if (roleName === "member") {
    return [
      "user:read:own",
      "user:update:own",
      "organization:read:organization",
    ];
  }

  return ["user:read:own", "user:update:own"];
}

export const DEFAULT_PERMISSION_KEYS = [
  "user:create:platform",
  "user:read:platform",
  "user:update:platform",
  "user:delete:platform",
  "user:create:organization",
  "user:read:organization",
  "user:update:organization",
  "user:delete:organization",
  "organization:create:platform",
  "organization:read:platform",
  "organization:update:platform",
  "organization:read:organization",
  "organization:update:organization",
  "organization:delete:platform",
  "role:create:platform",
  "role:read:platform",
  "role:update:platform",
  "role:delete:platform",
  "role:create:organization",
  "role:read:organization",
  "role:update:organization",
  "role:delete:organization",
  "setting:read:organization",
  "setting:update:organization",
  "setting:read:platform",
  "setting:update:platform",
  "invite:create:organization",
  "invite:read:organization",
  "invite:update:organization",
  "invite:delete:organization",
  "mail:create:organization",
  "mail:read:organization",
  "mail:update:organization",
  "mail:delete:organization",
  "notification:create:organization",
  "notification:read:organization",
  "notification:update:organization",
  "notification:delete:organization",
  "user:update:own",
] as const;
