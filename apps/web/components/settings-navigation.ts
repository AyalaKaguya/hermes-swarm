import type { AppShellNavSection } from "@/components/app-shell";

export const SETTINGS_NAV_ITEMS = [
  { href: "/settings/account", icon: "user", key: "account", label: "账号" },
  { href: "/settings/users", icon: "users", key: "users", label: "用户" },
  { href: "/settings/groups", icon: "users", key: "groups", label: "用户组" },
  { href: "/settings/roles", icon: "shield", key: "roles", label: "角色与权限" },
  {
    href: "/settings/email-templates",
    icon: "file",
    key: "email-templates",
    label: "邮件模板",
  },
  {
    href: "/settings/custom-smtp",
    icon: "settings",
    key: "custom-smtp",
    label: "自定义 SMTP",
  },
  { href: "/settings/features", icon: "grid", key: "features", label: "功能" },
  { href: "/settings/organizations", icon: "building", key: "organizations", label: "组织" },
  { href: "/settings/tenant", icon: "server", key: "tenant", label: "租户" },
] satisfies AppShellNavSection["items"];

export const SETTINGS_NAV_SECTIONS: AppShellNavSection[] = [
  {
    items: SETTINGS_NAV_ITEMS,
    key: "settings",
    label: "",
  },
];

export function getSettingsNavLabel(activeItem: string) {
  return (
    SETTINGS_NAV_ITEMS.find((item) => item.key === activeItem)?.label ??
    "设置"
  );
}
