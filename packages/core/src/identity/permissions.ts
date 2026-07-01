export const PERMISSION_ACTIONS = [] as const;

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
  void roleName;
  return [];
}

export const DEFAULT_PERMISSION_KEYS = [] as const;
