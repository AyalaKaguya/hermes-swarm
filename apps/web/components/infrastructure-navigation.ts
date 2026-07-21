import { PAGE_ACCESS_DEFINITIONS } from "@hermes-swarm/rbac-api";
import type { AppShellNavSection } from "@/components/app-shell";
import type { AppIconName } from "@/components/app-icon";

export type InfrastructureNavItem = AppShellNavSection["items"][number] & {
  pageKey: string;
  permission: string;
};

const SETTINGS_SECTIONS = ["personal", "workspace"];

export const INFRASTRUCTURE_NAV_ITEMS = [...PAGE_ACCESS_DEFINITIONS]
  .filter((item) => SETTINGS_SECTIONS.includes(item.section))
  .sort(
    (left, right) =>
      (left.order ?? Number.MAX_SAFE_INTEGER) -
        (right.order ?? Number.MAX_SAFE_INTEGER) ||
      left.label.localeCompare(right.label, "zh-Hans"),
  )
  .map((item) => ({
    href: item.href,
    icon: item.icon as AppIconName,
    key: item.key,
    label: item.label,
    pageKey: item.key,
    permission: item.permission,
  })) satisfies InfrastructureNavItem[];

export const INFRASTRUCTURE_NAV_SECTIONS = SETTINGS_SECTIONS.map(
  (section) => {
    const definition = PAGE_ACCESS_DEFINITIONS.find(
      (item) => item.section === section,
    );
    return {
      items: INFRASTRUCTURE_NAV_ITEMS.filter((item) =>
        PAGE_ACCESS_DEFINITIONS.some(
          (page) => page.key === item.pageKey && page.section === section,
        ),
      ),
      key: section,
      label: definition?.sectionLabel ?? section,
    };
  },
);

export function getInfrastructureNavLabel(activeItem: string) {
  return INFRASTRUCTURE_NAV_ITEMS.find((item) => item.key === activeItem)?.label ?? "设置";
}
