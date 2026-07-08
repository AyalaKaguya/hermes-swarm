import { PAGE_ACCESS_DEFINITIONS } from "@hermes-swarm/rbac-api";
import type { AppShellNavSection } from "@/components/app-shell";
import type { AppIconName } from "@/components/app-icon";

export type InfrastructureNavItem = AppShellNavSection["items"][number] & {
  pageKey: string;
  permission: string;
};

const BASE_INFRASTRUCTURE_NAV_ITEMS = [...PAGE_ACCESS_DEFINITIONS]
  .sort(
    (left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) -
        (right.order ?? Number.MAX_SAFE_INTEGER) ||
      left.label.localeCompare(right.label, "zh-Hans") ||
      left.key.localeCompare(right.key),
  )
  .map((item) => ({
    href: item.href,
    icon: item.icon as AppIconName,
    key: item.key,
    label: item.label,
    pageKey: item.key,
    permission: item.permission,
  })) satisfies InfrastructureNavItem[];

export const INFRASTRUCTURE_NAV_ITEMS = BASE_INFRASTRUCTURE_NAV_ITEMS.flatMap(
  (item) =>
    item.key === "settings.organization"
      ? [
          item,
          {
            href: "/settings/organization?tab=members",
            icon: "users" as AppIconName,
            key: "settings.organization.members",
            label: "成员",
            pageKey: item.pageKey,
            permission: item.permission,
          },
          {
            href: "/settings/organization?tab=controls",
            icon: "settings" as AppIconName,
            key: "settings.organization.controls",
            label: "控制项",
            pageKey: item.pageKey,
            permission: item.permission,
          },
          {
            href: "/settings/organization?tab=profile",
            icon: "palette" as AppIconName,
            key: "settings.organization.profile",
            label: "展示",
            pageKey: item.pageKey,
            permission: item.permission,
          },
        ]
      : item.key === "settings.platform"
        ? [
            item,
            {
              href: "/settings/platform?tab=defaults",
              icon: "settings" as AppIconName,
              key: "settings.platform.defaults",
              label: "默认控制项",
              pageKey: item.pageKey,
              permission: item.permission,
            },
            {
              href: "/settings/platform?tab=messaging",
              icon: "bell" as AppIconName,
              key: "settings.platform.messaging",
              label: "消息服务",
              pageKey: item.pageKey,
              permission: item.permission,
            },
            {
              href: "/settings/platform?tab=smtp",
              icon: "mail" as AppIconName,
              key: "settings.platform.smtp",
              label: "公共 SMTP",
              pageKey: item.pageKey,
              permission: item.permission,
            },
            {
              href: "/settings/platform?tab=admins",
              icon: "users" as AppIconName,
              key: "settings.platform.admins",
              label: "平台运营人员",
              pageKey: item.pageKey,
              permission: item.permission,
            },
            {
              href: "/settings/platform?tab=roles",
              icon: "shield" as AppIconName,
              key: "settings.platform.roles",
              label: "平台角色",
              pageKey: item.pageKey,
              permission: item.permission,
            },
            {
              href: "/settings/platform?tab=custom",
              icon: "database" as AppIconName,
              key: "settings.platform.custom",
              label: "自定义设置",
              pageKey: item.pageKey,
              permission: item.permission,
            },
          ]
        : [item],
) satisfies InfrastructureNavItem[];

export const INFRASTRUCTURE_NAV_SECTIONS = [
  "personal",
  "organization",
  "platform",
].map((section) => {
  const definition = PAGE_ACCESS_DEFINITIONS.find(
    (item) => item.section === section,
  );
  return {
    items: INFRASTRUCTURE_NAV_ITEMS.filter((item) =>
      PAGE_ACCESS_DEFINITIONS.some(
        (definition) =>
          definition.key === item.pageKey && definition.section === section,
      ),
    ),
    key: section,
    label: definition?.sectionLabel ?? section,
  };
});

export function getInfrastructureNavLabel(activeItem: string) {
  return (
    INFRASTRUCTURE_NAV_ITEMS.find((item) => item.key === activeItem)?.label ??
    "设置"
  );
}
