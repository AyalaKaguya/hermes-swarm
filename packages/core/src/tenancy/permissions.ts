export const TENANCY_MENU_PERMISSION_PREFIX = "menu";

export const DEFAULT_ADMIN_MENUS = [
  { code: "account", label: "账号", path: "/settings/account", sortOrder: 10 },
  {
    code: "organization",
    label: "组织常规",
    path: "/settings/organization",
    sortOrder: 20,
  },
  {
    code: "organization-controls",
    label: "组织控制项",
    path: "/settings/organization-controls",
    sortOrder: 30,
  },
  { code: "tags", label: "标签", path: "/settings/tags", sortOrder: 40 },
  {
    code: "custom-smtp",
    label: "自定义邮件",
    path: "/settings/custom-smtp",
    sortOrder: 50,
  },
  {
    code: "email-templates",
    label: "邮件模板",
    path: "/settings/email-templates",
    sortOrder: 60,
  },
  {
    code: "notification-destinations",
    label: "通知",
    path: "/settings/notification-destinations",
    sortOrder: 70,
  },
  { code: "features", label: "功能", path: "/settings/features", sortOrder: 80 },
  {
    code: "roles",
    label: "角色和权限",
    path: "/settings/roles",
    sortOrder: 90,
  },
  {
    code: "menus",
    label: "网页",
    path: "/settings/menus",
    sortOrder: 100,
  },
  {
    code: "tenant",
    label: "租户",
    path: "/settings/tenant",
    sortOrder: 110,
  },
  {
    code: "organizations",
    label: "组织列表",
    path: "/settings/organizations",
    sortOrder: 120,
  },
] as const;

export const DEPRECATED_ADMIN_MENU_CODES = [
  "groups",
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
export type MenuPermissionAction = "manage" | "view";

export function buildMenuPermissionKey(
  menuCode: string,
  action: MenuPermissionAction,
) {
  return `${TENANCY_MENU_PERMISSION_PREFIX}:${menuCode}:${action}`;
}

export function defaultPermissionsForRole(roleName: string) {
  const allPermissions = DEFAULT_ADMIN_MENUS.flatMap((menu) => [
    buildMenuPermissionKey(menu.code, "view"),
    buildMenuPermissionKey(menu.code, "manage"),
  ]);

  if (roleName === "platform-admin" || roleName === "owner" || roleName === "admin") {
    return allPermissions;
  }

  if (roleName === "member") {
    return DEFAULT_ADMIN_MENUS.filter((menu) =>
      ["account", "organization"].includes(menu.code),
    ).map((menu) => buildMenuPermissionKey(menu.code, "view"));
  }

  return DEFAULT_ADMIN_MENUS.filter((menu) => menu.code === "account").map(
    (menu) => buildMenuPermissionKey(menu.code, "view"),
  );
}
