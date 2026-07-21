"use client";

import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { SETTINGS_NAV_SECTIONS } from "@/components/settings/settings-navigation";
import { SettingsWorkspaceShell } from "@/components/settings/settings-workspace-shell";
import { usePermission } from "@/hooks/use-permission";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { resolveActiveSettingsNavigationKey } from "@/lib/settings-navigation-active";
import {
  findPageAccessDefinitionsByPath,
  type PageAccessDefinition,
} from "@hermes-swarm/rbac-api";

export default function SettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const t = useTranslations();
  const tr = useTextTranslation();
  const { resolvedSession, snapshot } = useAdminShell();
  const access = usePermission();
  const currentPages = findPageAccessDefinitionsByPath(pathname);
  const canAccessCurrentPage =
    currentPages.length > 0 &&
    currentPages.some((page) => access.hasPageAccess(page.key));

  const visibleSectionKeys = new Set(["personal", "workspace"]);
  const navSections = SETTINGS_NAV_SECTIONS.filter((section) =>
    visibleSectionKeys.has(section.key),
  )
    .map((section) => ({
      ...section,
      label: tr(section.label),
      items: section.items
        .filter((item) => {
          if (!snapshot || !resolvedSession) return false;
          return access.hasPageAccess(item.pageKey);
        })
        .map((item) => ({ ...item, label: tr(item.label) })),
    }))
    .filter((section) => section.items.length > 0);
  const visibleItems = navSections.flatMap((section) => section.items);
  const activeKey = resolveActiveSettingsNavigationKey(
    visibleItems,
    pathname,
    searchParams,
  );

  return (
    <SettingsWorkspaceShell
      activeKey={activeKey}
      ariaLabel={t("shell.settingsNavigation")}
      headerDescription={t("shell.settingsDescription")}
      headerTitle={t("shell.settings")}
      navSections={navSections}
    >
      {canAccessCurrentPage ? (
        children
      ) : (
        <SettingsAccessDenied pages={currentPages} />
      )}
    </SettingsWorkspaceShell>
  );
}

function SettingsAccessDenied({
  pages,
}: {
  pages: PageAccessDefinition[];
}) {
  const page = pages[0] ?? null;
  const t = useTranslations();
  const tr = useTextTranslation();

  return (
    <div className="flex min-h-[360px] items-center justify-center">
      <div className="grid max-w-md gap-2 text-center">
        <div className="text-base font-semibold">
          {t("shell.noPageAccessTitle")}
        </div>
        <div className="text-sm text-muted-foreground">
          {page
            ? t("shell.noPageAccessNamedDescription", { page: tr(page.label) })
            : t("shell.noPageAccessDescription")}
        </div>
        {pages.length > 0 && (
          <div className="grid gap-1 font-mono text-xs text-muted-foreground">
            {pages.map((item) => (
              <span key={item.permission}>{item.permission}</span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
