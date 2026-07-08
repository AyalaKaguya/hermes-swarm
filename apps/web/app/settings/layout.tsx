"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useAdminShell } from "@/components/admin-shell";
import { AppIcon } from "@/components/app-icon";
import {
  SETTINGS_NAV_SECTIONS,
  type SettingsNavItem,
} from "@/components/settings-navigation";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import {
  findPageAccessDefinitionsByPath,
  type PageAccessDefinition,
} from "@hermes-swarm/rbac-api";
import { usePermission } from "@/hooks/use-permission";
import { useTextTranslation } from "@/hooks/use-text-translation";
import { cn } from "@/lib/utils";

const SETTINGS_SIDEBAR_DEFAULT_SIZE = "240px";
const SETTINGS_SIDEBAR_MIN_SIZE = "56px";
const SETTINGS_SIDEBAR_MAX_SIZE = "320px";
const SETTINGS_SIDEBAR_COLLAPSED_THRESHOLD = 80;

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
  const [settingsSidebarCollapsed, setSettingsSidebarCollapsed] =
    useState(false);
  const activeOrganizationId = snapshot?.organization?.id ?? "none";
  const routeOrganizationId = getRouteOrganizationId(pathname);
  const currentPages = findPageAccessDefinitionsByPath(pathname);
  const canAccessCurrentPage =
    currentPages.length > 0 &&
    currentPages.some((page) =>
      access.hasPageAccess(page.key, {
        organizationId: routeOrganizationId ?? snapshot?.organization?.id,
      }),
    );

  const navSections = SETTINGS_NAV_SECTIONS.map((section) => ({
    ...section,
    label: tr(section.label),
    items: section.items
      .filter((item) => {
        if (!snapshot || !resolvedSession) return false;
        return access.hasPageAccess(item.pageKey, {
          organizationId: snapshot.organization?.id,
        });
      })
      .map((item) => ({ ...item, label: tr(item.label) })),
  })).filter((section) => section.items.length > 0);
  const visibleItems = navSections.flatMap((section) => section.items);

  const activeKey =
    visibleItems.find((item) =>
      matchesSettingsHref(item.href, pathname, searchParams, true),
    )?.key ??
    visibleItems.find((item) =>
      matchesSettingsHref(item.href, pathname, searchParams, false),
    )?.key;

  return (
    <div className="min-h-svh min-w-0 bg-background lg:h-svh lg:overflow-hidden">
      <div className="hidden h-full min-h-0 lg:block">
        <ResizablePanelGroup className="h-full min-h-0" orientation="horizontal">
          <ResizablePanel
            className="min-h-0 border-r bg-muted/20"
            defaultSize={SETTINGS_SIDEBAR_DEFAULT_SIZE}
            groupResizeBehavior="preserve-pixel-size"
            id="settings-navigation"
            maxSize={SETTINGS_SIDEBAR_MAX_SIZE}
            minSize={SETTINGS_SIDEBAR_MIN_SIZE}
            onResize={(size) =>
              setSettingsSidebarCollapsed(
                size.inPixels <= SETTINGS_SIDEBAR_COLLAPSED_THRESHOLD,
              )
            }
          >
            <SettingsSidebar
              activeKey={activeKey}
              collapsed={settingsSidebarCollapsed}
              navSections={navSections}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            className="min-h-0 min-w-0 overflow-hidden"
            id="settings-content"
            minSize="360px"
          >
            <div className="h-full min-w-0 overflow-auto px-4 py-5 lg:px-5">
              <div
                className="mx-auto flex max-w-7xl flex-col gap-4"
                key={activeOrganizationId}
              >
                {canAccessCurrentPage ? (
                  children
                ) : (
                  <SettingsAccessDenied pages={currentPages} />
                )}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="hidden min-w-0 gap-4 px-4 py-5 max-lg:grid">
        <nav
          aria-label={t("shell.settingsNavigation")}
          className="-mx-4 flex min-w-0 gap-2 overflow-x-auto border-b px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleItems.map((item) => (
            <Link
              className={cn(
                "flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                item.key === activeKey && "bg-accent",
              )}
              href={item.href}
              key={item.key}
            >
              <AppIcon
                className="size-4 shrink-0"
                name={item.icon ?? "settings"}
              />
              <span className="whitespace-nowrap">{item.label}</span>
            </Link>
          ))}
        </nav>
        <div key={activeOrganizationId}>
          {canAccessCurrentPage ? (
            children
          ) : (
            <SettingsAccessDenied pages={currentPages} />
          )}
        </div>
      </div>
    </div>
  );
}

function SettingsSidebar({
  activeKey,
  collapsed,
  navSections,
}: {
  activeKey?: string;
  collapsed: boolean;
  navSections: Array<{
    items: SettingsNavItem[];
    key: string;
    label: string;
  }>;
}) {
  const t = useTranslations();

  return (
    <aside
      aria-label={t("shell.settingsNavigation")}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        collapsed && "items-center",
      )}
    >
      <div className="flex h-12 w-full items-center gap-2 border-b px-2">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            collapsed && "mx-auto",
          )}
          title={t("shell.settings")}
        >
          <AppIcon className="size-4" name="settings" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">
              {t("shell.settings")}
            </div>
            <div className="truncate text-xs">
              {t("shell.settingsDescription")}
            </div>
          </div>
        )}
      </div>
      <div className="min-h-0 w-full flex-1 overflow-auto px-2 py-3">
        {navSections.map((section, sectionIndex) => (
          <div className="grid gap-1" key={section.key}>
            {sectionIndex > 0 && <Separator className="my-2" />}
            {!collapsed && (
              <div className="px-2 py-1 text-[0.68rem] font-medium uppercase">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const active = item.key === activeKey;
              return (
                <Link
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-lg px-2 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-accent",
                    collapsed && "justify-center",
                  )}
                  href={item.href}
                  key={item.key}
                  title={item.label}
                >
                  <AppIcon
                    className="size-4 shrink-0"
                    name={item.icon ?? "settings"}
                  />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </div>
    </aside>
  );
}

function matchesSettingsHref(
  href: string,
  pathname: string,
  searchParams: { get(name: string): string | null },
  queryOnly: boolean,
) {
  const [hrefWithoutHash] = href.split("#");
  const [hrefPath, hrefQuery] = hrefWithoutHash.split("?");

  if (hrefQuery) {
    if (!queryOnly || pathname !== hrefPath) return false;
    const expectedParams = new URLSearchParams(hrefQuery);
    for (const [key, value] of expectedParams) {
      if (searchParams.get(key) !== value) return false;
    }
    return true;
  }

  if (queryOnly) return false;
  return pathname === hrefPath || pathname.startsWith(`${hrefPath}/`);
}

function getRouteOrganizationId(pathname: string) {
  const match = pathname.match(/^\/settings\/organizations\/([^/]+)$/);
  return match?.[1] ?? null;
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
