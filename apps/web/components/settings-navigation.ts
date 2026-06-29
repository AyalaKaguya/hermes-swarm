import type { AppShellNavSection } from "@/components/app-shell";

export type SettingsNavItem = AppShellNavSection["items"][number];

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
  {
    href: "/settings/roles",
    icon: "shield",
    key: "roles",
    label: "角色和权限",
  },
  {
    href: "/settings/platform",
    icon: "server",
    key: "platform",
    label: "平台设置",
  },
  {
    href: "/settings/organizations",
    icon: "building",
    key: "organizations",
    label: "组织列表",
  },
] satisfies SettingsNavItem[];

export const SETTINGS_NAV_SECTIONS = [
  {
    items: SETTINGS_NAV_ITEMS.filter((item) => item.key === "account"),
    key: "personal",
    label: "个人",
  },
  {
    items: SETTINGS_NAV_ITEMS.filter((item) =>
      [
        "organization",
        "custom-smtp",
        "email-templates",
        "notification-destinations",
        "features",
        "roles",
      ].includes(item.key),
    ),
    key: "organization",
    label: "组织",
  },
  {
    items: SETTINGS_NAV_ITEMS.filter((item) =>
      ["platform", "organizations"].includes(item.key),
    ),
    key: "platform",
    label: "平台",
  },
];

export function getSettingsNavLabel(activeItem: string) {
  return (
    SETTINGS_NAV_ITEMS.find((item) => item.key === activeItem)?.label ??
    "设置"
  );
}
