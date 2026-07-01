import { PAGE_ACCESS_DEFINITIONS } from "@hermes-swarm/access";
import type { AppShellNavSection } from "@/components/app-shell";
import type { AppIconName } from "@/components/app-icon";

export type SettingsNavItem = AppShellNavSection["items"][number] & {
  pageKey: string;
  permission: string;
};

export const SETTINGS_NAV_ITEMS = PAGE_ACCESS_DEFINITIONS.map((item) => ({
  href: item.href,
  icon: item.icon as AppIconName,
  key: item.key,
  label: item.label,
  pageKey: item.key,
  permission: item.permission,
})) satisfies SettingsNavItem[];

export const SETTINGS_NAV_SECTIONS = ["personal", "organization", "platform"].map(
  (section) => {
    const definition = PAGE_ACCESS_DEFINITIONS.find(
      (item) => item.section === section,
    );
    return {
      items: SETTINGS_NAV_ITEMS.filter((item) =>
        PAGE_ACCESS_DEFINITIONS.some(
          (definition) =>
            definition.key === item.pageKey && definition.section === section,
        ),
      ),
      key: section,
      label: definition?.sectionLabel ?? section,
    };
  },
);

export function getSettingsNavLabel(activeItem: string) {
  return (
    SETTINGS_NAV_ITEMS.find((item) => item.key === activeItem)?.label ??
    "设置"
  );
}
