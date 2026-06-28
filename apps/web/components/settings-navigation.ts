import type { AppShellNavSection } from "@/components/app-shell";
import { DEFAULT_ADMIN_MENUS } from "@hermes-swarm/core/tenancy/permissions";

export type SettingsNavItem = AppShellNavSection["items"][number];

type AdminMenuCode = (typeof DEFAULT_ADMIN_MENUS)[number]["code"];

const SETTINGS_NAV_UI: Record<
  AdminMenuCode,
  {
    icon: SettingsNavItem["icon"];
    label?: string;
  }
> = {
  account: { icon: "user" },
  "custom-smtp": { icon: "settings" },
  "email-templates": { icon: "file" },
  features: { icon: "grid" },
  menus: { icon: "menu" },
  "notification-destinations": { icon: "bell" },
  organization: { icon: "building", label: "常规" },
  organizations: { icon: "building" },
  roles: { icon: "shield" },
  tags: { icon: "layers" },
  tenant: { icon: "server", label: "平台设置" },
};

export const SETTINGS_NAV_ITEMS = DEFAULT_ADMIN_MENUS.map((menu) => {
  const ui = SETTINGS_NAV_UI[menu.code];
  return {
    href: menu.path,
    icon: ui.icon,
    key: menu.code,
    label: ui.label ?? menu.label,
  };
}) satisfies SettingsNavItem[];

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

export function getSettingsNavLabel(activeItem: string) {
  return (
    SETTINGS_NAV_ITEMS.find((item) => item.key === activeItem)?.label ??
    "设置"
  );
}
