import type { AppShellNavSection } from "@/components/app-shell";
import type { RequestScopeLevel } from "@/lib/admin-api";

export type SettingsScopeContext = "dual-scope" | "organization-only" | "platform-only";
export type SettingsNavItem = AppShellNavSection["items"][number] & {
  scopeContext?: SettingsScopeContext;
};

export const SETTINGS_NAV_ITEMS = [
  {
    href: "/settings/account",
    icon: "user",
    key: "account",
    label: "账号",
    scopeContext: "dual-scope",
  },
  {
    href: "/settings/organization",
    icon: "building",
    key: "organization",
    label: "常规",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/organization-controls",
    icon: "settings",
    key: "organization-controls",
    label: "控制项",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/tags",
    icon: "layers",
    key: "tags",
    label: "标签",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/custom-smtp",
    icon: "settings",
    key: "custom-smtp",
    label: "自定义邮件",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/email-templates",
    icon: "file",
    key: "email-templates",
    label: "邮件模板",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/notification-destinations",
    icon: "bell",
    key: "notification-destinations",
    label: "通知",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/features",
    icon: "grid",
    key: "features",
    label: "功能",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/roles",
    icon: "shield",
    key: "roles",
    label: "角色和权限",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/menus",
    icon: "menu",
    key: "menus",
    label: "网页",
    scopeContext: "organization-only",
  },
  {
    href: "/settings/tenant",
    icon: "server",
    key: "tenant",
    label: "平台设置",
    scopeContext: "platform-only",
  },
  {
    href: "/settings/organizations",
    icon: "building",
    key: "organizations",
    label: "组织列表",
    scopeContext: "platform-only",
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
        "organization-controls",
        "tags",
        "custom-smtp",
        "email-templates",
        "notification-destinations",
        "features",
        "roles",
        "menus",
      ].includes(item.key),
    ),
    key: "organization",
    label: "组织",
  },
  {
    items: SETTINGS_NAV_ITEMS.filter((item) =>
      ["tenant", "organizations"].includes(item.key),
    ),
    key: "tenant",
    label: "租户管理",
  },
];

export function matchesSettingsScope(
  item: SettingsNavItem,
  scopeLevel: RequestScopeLevel,
) {
  const scope = item.scopeContext ?? "dual-scope";
  if (scope === "dual-scope") return true;
  if (scope === "platform-only") return scopeLevel === "platform";
  return scopeLevel === "organization";
}

export function getSettingsNavLabel(activeItem: string) {
  return (
    SETTINGS_NAV_ITEMS.find((item) => item.key === activeItem)?.label ??
    "设置"
  );
}
