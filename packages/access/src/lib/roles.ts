export const PLATFORM_ADMIN_ROLE_NAME = "platform-admin";

export function isPlatformAdminRoleName(roleName: string | null | undefined) {
  return roleName === PLATFORM_ADMIN_ROLE_NAME;
}
