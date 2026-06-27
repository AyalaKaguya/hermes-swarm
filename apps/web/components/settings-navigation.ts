import type { AppShellNavSection } from "@/components/app-shell";

export const SETTINGS_NAV_ITEMS = [
  {
    href: "/settings/account",
    icon: "user",
    key: "account",
    label: "账号",
  },
  {
    href: "/settings/organization",
    icon: "building",
    key: "organization",
    label: "常规",
  },
  {
    href: "/settings/organization-controls",
    icon: "settings",
    key: "organization-controls",
    label: "控制项",
  },
  { href: "/settings/tags", icon: "layers", key: "tags", label: "标签" },
  {
    href: "/settings/custom-smtp",
    icon: "settings",
    key: "custom-smtp",
    label: "自定义邮件",
  },
  {
    href: "/settings/email-templates",
    icon: "file",
    key: "email-templates",
    label: "邮件模板",
  },
  {
    href: "/settings/notification-destinations",
    icon: "bell",
    key: "notification-destinations",
    label: "通知",
  },
  {
    href: "/settings/features",
    icon: "grid",
    key: "features",
    label: "功能",
  },
  { href: "/settings/users", icon: "users", key: "users", label: "成员" },
  { href: "/settings/groups", icon: "users", key: "groups", label: "用户组" },
  {
    href: "/settings/roles",
    icon: "shield",
    key: "roles",
    label: "角色和权限",
  },
  { href: "/settings/tenant", icon: "server", key: "tenant", label: "租户" },
  {
    href: "/settings/organizations",
    icon: "building",
    key: "organizations",
    label: "组织列表",
  },
] satisfies AppShellNavSection["items"];

export const SETTINGS_NAV_SECTIONS: AppShellNavSection[] = [
  {
    items: SETTINGS_NAV_ITEMS.filter((item) => item.key === "account"),
    key: "personal",
    label: "个人",
  },
  {
    items: SETTINGS_NAV_ITEMS.filter((item) =>
      [
        "organization",
        "organization-controls",
        "tags",
        "custom-smtp",
        "email-templates",
        "notification-destinations",
        "features",
        "users",
        "groups",
      ].includes(item.key),
    ),
    key: "organization",
    label: "组织",
  },
  {
    items: SETTINGS_NAV_ITEMS.filter((item) =>
      ["roles", "tenant", "organizations"].includes(item.key),
    ),
    key: "tenant",
    label: "租户管理",
  },
];

export function getSettingsNavLabel(activeItem: string) {
  return (
    SETTINGS_NAV_ITEMS.find((item) => item.key === activeItem)?.label ??
    "设置"
  );
}
