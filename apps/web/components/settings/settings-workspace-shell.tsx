"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

const SETTINGS_SIDEBAR_DEFAULT_SIZE = "240px";
const SETTINGS_SIDEBAR_MIN_SIZE = "56px";
const SETTINGS_SIDEBAR_MAX_SIZE = "320px";
const SETTINGS_SIDEBAR_COLLAPSED_THRESHOLD = 80;

export type SettingsWorkspaceNavItem = {
  href: string;
  icon?: AppIconName;
  key: string;
  label: string;
};

export type SettingsWorkspaceNavSection = {
  items: SettingsWorkspaceNavItem[];
  key: string;
  label: string;
};

export function SettingsWorkspaceShell({
  activeKey,
  ariaLabel,
  children,
  headerDescription,
  headerTitle,
  idPrefix = "settings",
  navSections,
}: {
  activeKey?: string;
  ariaLabel: string;
  children: ReactNode;
  headerDescription: string;
  headerTitle: string;
  idPrefix?: string;
  navSections: SettingsWorkspaceNavSection[];
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const visibleItems = navSections.flatMap((section) => section.items);

  return (
    <div className="min-h-svh min-w-0 bg-background lg:h-svh lg:overflow-hidden">
      <div className="hidden h-full min-h-0 lg:block">
        <ResizablePanelGroup className="h-full min-h-0" orientation="horizontal">
          <ResizablePanel
            className="min-h-0 border-r bg-muted/20"
            defaultSize={SETTINGS_SIDEBAR_DEFAULT_SIZE}
            groupResizeBehavior="preserve-pixel-size"
            id={`${idPrefix}-navigation`}
            maxSize={SETTINGS_SIDEBAR_MAX_SIZE}
            minSize={SETTINGS_SIDEBAR_MIN_SIZE}
            onResize={(size) =>
              setSidebarCollapsed(
                size.inPixels <= SETTINGS_SIDEBAR_COLLAPSED_THRESHOLD,
              )
            }
          >
            <SettingsWorkspaceSidebar
              activeKey={activeKey}
              ariaLabel={ariaLabel}
              collapsed={sidebarCollapsed}
              headerDescription={headerDescription}
              headerTitle={headerTitle}
              navSections={navSections}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            className="min-h-0 min-w-0 overflow-hidden"
            id={`${idPrefix}-content`}
            minSize="360px"
          >
            <div
              className="h-full min-w-0 overflow-auto px-4 py-5 lg:px-5"
              data-testid={`${idPrefix}-content`}
            >
              <div className="mx-auto flex max-w-7xl flex-col gap-4">
                {children}
              </div>
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <div className="hidden min-w-0 gap-4 px-4 py-5 max-lg:grid">
        <nav
          aria-label={ariaLabel}
          className="-mx-4 flex min-w-0 gap-2 overflow-x-auto border-b px-4 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {visibleItems.map((item) => {
            const active = item.key === activeKey;
            return (
              <Link
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                  active && "bg-accent",
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
            );
          })}
        </nav>
        <div>{children}</div>
      </div>
    </div>
  );
}

function SettingsWorkspaceSidebar({
  activeKey,
  ariaLabel,
  collapsed,
  headerDescription,
  headerTitle,
  navSections,
}: {
  activeKey?: string;
  ariaLabel: string;
  collapsed: boolean;
  headerDescription: string;
  headerTitle: string;
  navSections: SettingsWorkspaceNavSection[];
}) {
  return (
    <aside
      aria-label={ariaLabel}
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        collapsed && "items-center",
      )}
      data-testid="settings-workspace-navigation"
    >
      <div className="flex h-12 w-full items-center gap-2 border-b px-2">
        <span
          className={cn(
            "grid size-8 shrink-0 place-items-center rounded-md",
            collapsed && "mx-auto",
          )}
          title={headerTitle}
        >
          <AppIcon className="size-4" name="settings" />
        </span>
        {!collapsed && (
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{headerTitle}</div>
            <div className="truncate text-xs">{headerDescription}</div>
          </div>
        )}
      </div>
      <ScrollArea className="min-h-0 w-full flex-1">
        <div className="px-2 py-3">
          {navSections.map((section, sectionIndex) => (
            <div className="grid gap-1" key={section.key}>
              {sectionIndex > 0 && <Separator className="my-2" />}
              {!collapsed && section.label && (
                <div className="px-2 py-1 text-[0.68rem] font-medium uppercase">
                  {section.label}
                </div>
              )}
              {section.items.map((item) => {
                const active = item.key === activeKey;
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
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
      </ScrollArea>
    </aside>
  );
}
