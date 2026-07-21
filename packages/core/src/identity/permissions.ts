export const PERMISSION_ACTIONS = [] as const;

export const PERMISSION_SCOPES = [
  "platform",
  "workspace",
  "own",
] as const;

export type EntityPermissionAction = (typeof PERMISSION_ACTIONS)[number];
export type EntityPermissionScope = (typeof PERMISSION_SCOPES)[number];

export const PLATFORM_ADMIN_ROLE_NAME = "platform-admin";

export function isPlatformAdminRoleName(roleName: string | null | undefined) {
  return roleName === PLATFORM_ADMIN_ROLE_NAME;
}

export function defaultPermissionsForRole(roleName: string) {
  void roleName;
  return [];
}
