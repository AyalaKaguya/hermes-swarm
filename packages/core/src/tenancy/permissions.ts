export const TENANCY_MENU_PERMISSION_PREFIX = "menu";

export const DEFAULT_ADMIN_MENUS = [
  { code: "tenants", label: "租户管理", path: "/organizations", sortOrder: 10 },
  {
    code: "organizations",
    label: "组织管理",
    path: "/organizations",
    sortOrder: 20,
  },
  { code: "users", label: "用户管理", path: "/organizations", sortOrder: 30 },
  { code: "roles", label: "角色管理", path: "/organizations", sortOrder: 40 },
  { code: "menus", label: "菜单管理", path: "/organizations", sortOrder: 50 },
  {
    code: "permissions",
    label: "权限配置",
    path: "/organizations",
    sortOrder: 60,
  },
  { code: "settings", label: "系统配置", path: "/organizations", sortOrder: 70 },
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
      ["organizations", "users"].includes(menu.code),
    ).map((menu) => buildMenuPermissionKey(menu.code, "view"));
  }

  return DEFAULT_ADMIN_MENUS.filter((menu) => menu.code === "organizations").map(
    (menu) => buildMenuPermissionKey(menu.code, "view"),
  );
}
