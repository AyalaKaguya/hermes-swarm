export const TENANCY_MENU_PERMISSION_PREFIX = "menu";

export const DEFAULT_ADMIN_MENUS = [
  { code: "account", label: "账号", path: "/settings/account", sortOrder: 10 },
  { code: "users", label: "用户", path: "/settings/users", sortOrder: 20 },
  {
    code: "groups",
    label: "用户组",
    path: "/settings/groups",
    sortOrder: 30,
  },
  {
    code: "roles",
    label: "角色",
    path: "/settings/roles",
    sortOrder: 35,
  },
  {
    code: "email-templates",
    label: "邮件模板",
    path: "/settings/email-templates",
    sortOrder: 40,
  },
  {
    code: "custom-smtp",
    label: "自定义 SMTP",
    path: "/settings/custom-smtp",
    sortOrder: 50,
  },
  { code: "features", label: "功能", path: "/settings/features", sortOrder: 60 },
  { code: "organizations", label: "组织", path: "/settings/organizations", sortOrder: 70 },
  {
    code: "tenant",
    label: "租户",
    path: "/settings/tenant",
    sortOrder: 80,
  },
] as const;

export const DEPRECATED_ADMIN_MENU_CODES = [
  "organization",
  "menus",
  "permissions",
  "settings",
  "user-groups",
] as const;

export const SYSTEM_ROLES = [
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

  if (roleName === "owner" || roleName === "admin") {
    return allPermissions;
  }

  if (roleName === "member") {
    return DEFAULT_ADMIN_MENUS.filter((menu) =>
      ["account", "users", "organizations"].includes(menu.code),
    ).map((menu) => buildMenuPermissionKey(menu.code, "view"));
  }

  return DEFAULT_ADMIN_MENUS.filter((menu) => menu.code === "account").map(
    (menu) => buildMenuPermissionKey(menu.code, "view"),
  );
}
