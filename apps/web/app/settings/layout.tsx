"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon } from "@/components/app-icon";
import { AppShell } from "@/components/app-shell";
import { SETTINGS_NAV_SECTIONS } from "@/components/settings-navigation";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Separator } from "@/components/ui/separator";
import { getSnapshot, switchOrganizationScope } from "@/lib/admin-api";
import type { Snapshot } from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  hasMenuAccess,
  resolveSession,
  storeSession,
} from "@/lib/session";
import type { ResolvedSession } from "@/lib/session";
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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] = useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [settingsSidebarCollapsed, setSettingsSidebarCollapsed] = useState(false);

  useEffect(() => {
    async function load() {
      const session = getStoredSession();
      if (!session) {
        setLoading(false);
        return;
      }
      try {
        const data = await getSnapshot(session.token);
        setSnapshot(data);
        setResolvedSession(resolveSession(data));
      } catch {
        clearStoredSession();
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  const navSections = SETTINGS_NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items.filter((item) => {
      if (!snapshot || !resolvedSession) return false;
      const menu = snapshot.menus.find((candidate) => candidate.code === item.key);
      return Boolean(menu?.isActive) && hasMenuAccess(snapshot, resolvedSession, item.key);
    }),
  })).filter((section) => section.items.length > 0);
  const visibleItems = navSections.flatMap((section) => section.items);

  const activeKey = visibleItems.find(
    (item) => pathname === item.href || pathname.startsWith(item.href + "/")
  )?.key;

  async function switchOrganization(organizationId: string) {
    const session = getStoredSession();
    if (!session?.token || organizationId === snapshot?.organization.id) return;
    const result = await switchOrganizationScope(session.token, organizationId);
    storeSession({ token: result.token });
    setSnapshot(result.snapshot);
    setResolvedSession(resolveSession(result.snapshot));
  }

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-sm text-muted-foreground">加载中...</span>
      </div>
    );
  }

  return (
    <AppShell
      activeItem={activeKey}
      contentClassName="p-0"
      currentOrganizationId={snapshot?.organization.id}
      onOrganizationSwitch={switchOrganization}
      organizationName={snapshot?.organization?.name ?? resolvedSession?.organization?.name}
      organizations={snapshot?.organizations}
      user={resolvedSession?.user}
    >
      <div className="min-h-svh min-w-0 bg-background">
        <ResizablePanelGroup className="hidden min-h-svh md:flex" orientation="horizontal">
          <ResizablePanel
            className="border-r bg-muted/20"
            defaultSize={SETTINGS_SIDEBAR_DEFAULT_SIZE}
            groupResizeBehavior="preserve-pixel-size"
            id="settings-navigation"
            maxSize={SETTINGS_SIDEBAR_MAX_SIZE}
            minSize={SETTINGS_SIDEBAR_MIN_SIZE}
            onResize={(size) =>
              setSettingsSidebarCollapsed(size.inPixels <= SETTINGS_SIDEBAR_COLLAPSED_THRESHOLD)
            }
          >
            <SettingsSidebar
              activeKey={activeKey}
              collapsed={settingsSidebarCollapsed}
              navSections={navSections}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel className="min-w-0" id="settings-content" minSize="360px">
            <div className="min-w-0 px-4 py-5 md:px-5">
              <div className="mx-auto flex max-w-7xl flex-col gap-4">
                {children}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>

        <div className="grid min-w-0 gap-4 px-4 py-5 md:hidden">
          <div className="grid gap-1 rounded-lg border bg-muted/20 p-2">
            {navSections.map((section) => (
              <div className="grid gap-1" key={section.key}>
                <div className="px-2 py-1 text-xs text-muted-foreground">
                  {section.label}
                </div>
                {section.items.map((item) => (
                  <Link
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-md px-2 text-sm",
                      item.key === activeKey && "bg-accent text-accent-foreground",
                    )}
                    href={item.href}
                    key={item.key}
                  >
                    <AppIcon className="size-4" name={item.icon ?? "settings"} />
                    <span>{item.label}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
          {children}
        </div>
      </div>
    </AppShell>
  );
}

function SettingsSidebar({
  activeKey,
  collapsed,
  navSections,
}: {
  activeKey?: string;
  collapsed: boolean;
  navSections: typeof SETTINGS_NAV_SECTIONS;
}) {
  return (
    <aside
      aria-label="配置导航"
      className={cn("flex h-full min-h-svh flex-col", collapsed && "items-center")}
    >
      <div className="flex h-12 w-full items-center gap-2 border-b px-2">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md text-muted-foreground",
            collapsed && "mx-auto",
          )}
          title="配置"
        >
          <AppIcon className="size-4" name="panel" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">配置</div>
            <div className="truncate text-xs text-muted-foreground">
              个人、组织与租户管理
            </div>
          </div>
        )}
      </div>
      <div className="w-full flex-1 overflow-auto px-2 py-3">
        {navSections.map((section, sectionIndex) => (
          <div className="grid gap-1" key={section.key}>
            {sectionIndex > 0 && <Separator className="my-2" />}
            {!collapsed && (
              <div className="px-2 py-1 text-[0.68rem] font-medium uppercase text-muted-foreground">
                {section.label}
              </div>
            )}
            {section.items.map((item) => {
              const active = item.key === activeKey;
              return (
                <Link
                  className={cn(
                    "flex h-8 items-center gap-2 rounded-lg px-2 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring",
                    active && "bg-accent text-accent-foreground",
                    collapsed && "justify-center",
                  )}
                  href={item.href}
                  key={item.key}
                  title={item.label}
                >
                  <AppIcon className="size-4 shrink-0" name={item.icon ?? "settings"} />
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
