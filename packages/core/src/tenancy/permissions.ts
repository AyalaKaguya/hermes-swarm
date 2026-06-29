export const TENANCY_PERMISSION_ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
] as const;

export const TENANCY_PERMISSION_SCOPES = [
  "platform",
  "organization",
  "own",
] as const;

export type TenancyPermissionAction = (typeof TENANCY_PERMISSION_ACTIONS)[number];
export type TenancyPermissionScope = (typeof TENANCY_PERMISSION_SCOPES)[number];

export const TENANCY_MENU_PERMISSION_PREFIX = "menu";
export type MenuPermissionAction = "manage" | "view";

export const DEFAULT_ADMIN_MENUS = [
  { code: "account", label: "账号", path: "/settings/account", sortOrder: 10 },
  {
    code: "organization",
    label: "组织常规",
    path: "/settings/organization",
    sortOrder: 20,
  },
  {
    code: "custom-smtp",
    label: "自定义邮件",
    path: "/settings/custom-smtp",
    sortOrder: 40,
  },
  {
    code: "email-templates",
    label: "邮件模板",
    path: "/settings/email-templates",
    sortOrder: 50,
  },
  {
    code: "notification-destinations",
    label: "通知",
    path: "/settings/notification-destinations",
    sortOrder: 60,
  },
  { code: "features", label: "功能", path: "/settings/features", sortOrder: 70 },
  {
    code: "roles",
    label: "角色和权限",
    path: "/settings/roles",
    sortOrder: 80,
  },
  {
    code: "menus",
    label: "网页",
    path: "/settings/menus",
    sortOrder: 90,
  },
  {
    code: "tenant",
    label: "租户",
    path: "/settings/tenant",
    sortOrder: 100,
  },
  {
    code: "organizations",
    label: "组织列表",
    path: "/settings/organizations",
    sortOrder: 110,
  },
] as const;

export const DEPRECATED_ADMIN_MENU_CODES = [
  "groups",
  "organization-controls",
  "permissions",
  "settings",
  "user-groups",
  "users",
] as const;

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

export const PLATFORM_MENU_CODES = ["tenant", "organizations"] as const;
export const PLATFORM_MENU_CODE_SET = new Set<string>(PLATFORM_MENU_CODES);

export function getRoleRank(roleName: string | null | undefined) {
  if (!roleName) return 0;
  return ROLE_RANKS[roleName as SystemRoleName] ?? CUSTOM_ROLE_RANK;
}

export function isPlatformAdminRoleName(roleName: string | null | undefined) {
  return roleName === PLATFORM_ADMIN_ROLE_NAME;
}

export function isPlatformMenuCode(menuCode: string) {
  return PLATFORM_MENU_CODE_SET.has(menuCode);
}

export function buildMenuPermissionKey(
  menuCode: string,
  action: MenuPermissionAction,
) {
  return `${TENANCY_MENU_PERMISSION_PREFIX}:${menuCode}:${action}`;
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
    return ["user:read:own", "organization:read:organization"];
  }

  return ["user:read:own"];
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
] as const;
