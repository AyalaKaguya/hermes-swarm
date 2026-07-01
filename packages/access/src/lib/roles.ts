import type { SystemRoleName } from "./types.js";

export const PLATFORM_ADMIN_ROLE_NAME = "platform-admin";

export const SYSTEM_ROLES = [
  { isSystem: true, label: "Platform Admin", name: "platform-admin" },
  { isSystem: true, label: "Owner", name: "owner" },
  { isSystem: true, label: "Admin", name: "admin" },
  { isSystem: true, label: "Member", name: "member" },
  { isSystem: true, label: "Viewer", name: "viewer" },
] as const satisfies Array<{
  isSystem: true;
  label: string;
  name: SystemRoleName;
}>;

export function isPlatformAdminRoleName(roleName: string | null | undefined) {
  return roleName === PLATFORM_ADMIN_ROLE_NAME;
}
