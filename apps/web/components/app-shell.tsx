"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { NotificationCenter } from "@/components/notification-center";
import { UserAvatar } from "@/components/user-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { Organization, User } from "@/lib/admin-api";
import type { RequestScopeLevel } from "@/lib/admin-api";
import { cn } from "@/lib/utils";

const MAIN_SIDEBAR_STATE_KEY = "sidebar_state";
const MAIN_SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

export type AppShellNavItem = {
  badge?: string;
  icon?: AppIconName;
  href: string;
  key: string;
  label: string;
};

export type AppShellNavSection = {
  badge?: string;
  items: AppShellNavItem[];
  key: string;
  label: string;
};

export function AppShell({
  actions,
  activeItem,
  children,
  contentClassName,
  canUsePlatformScope,
  currentOrganizationId,
  currentScopeLevel,
  navSections,
  onNavigate,
  onOrganizationSwitch,
  onPlatformScopeSwitch,
  organizationName,
  organizations,
  platformName,
  user,
}: {
  actions?: ReactNode;
  activeItem?: string;
  children: ReactNode;
  canUsePlatformScope?: boolean;
  contentClassName?: string;
  currentOrganizationId?: string | null;
  currentScopeLevel?: RequestScopeLevel;
  navSections?: AppShellNavSection[];
  onNavigate?: (item: AppShellNavItem) => void;
  onOrganizationSwitch?: (organizationId: string) => void | Promise<void>;
  onPlatformScopeSwitch?: () => void | Promise<void>;
  organizationName?: string | null;
  organizations?: Organization[];
  platformName?: string | null;
  user?: User | null;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const [mainSidebarOpen, setMainSidebarOpen] = useState(false);
  const sections = navSections ?? [];
  const shellTitle = platformName?.trim() || "Hermes Swarm";

  useEffect(() => {
    function syncHash() {
      setHash(window.location.hash);
    }

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  useEffect(() => {
    const stored = readStoredSidebarState();
    if (stored !== null) {
      setMainSidebarOpen(stored);
    }
  }, []);

  function updateMainSidebarOpen(open: boolean) {
    setMainSidebarOpen(open);
    writeStoredSidebarState(open);
  }

  return (
    <SidebarProvider
      defaultOpen={false}
      onOpenChange={updateMainSidebarOpen}
      open={mainSidebarOpen}
      style={
        {
          "--sidebar-width": "15.625rem",
          "--sidebar-width-icon": "3.125rem",
        } as CSSProperties
      }
    >
      <Sidebar collapsible="icon" className="border-r">
        <SidebarHeader className="gap-2 p-2">
          <div className="flex min-h-10 items-center gap-2">
            <Link
              className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold text-sidebar-foreground outline-none transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
              href="/home"
            >
              {shellTitle}
            </Link>
            <SidebarTrigger className="size-8 shrink-0" />
          </div>

          <ScopeSwitcher
            canUsePlatformScope={Boolean(canUsePlatformScope)}
            currentOrganizationId={currentOrganizationId}
            currentScopeLevel={currentScopeLevel ?? "organization"}
            onOrganizationSwitch={onOrganizationSwitch}
            onPlatformScopeSwitch={onPlatformScopeSwitch}
            organizationName={organizationName}
            organizations={organizations ?? []}
          />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <ShellMenuItem
                  active={pathname === "/home"}
                  href="/home"
                  icon="home"
                  label="主页"
                />
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>

          {sections.length > 0 && (
            <>
              <SidebarSeparator />
              {sections.map((section) => (
                <SidebarGroup key={section.key}>
                  {(section.label || section.badge) && (
                    <SidebarGroupLabel>
                      <span className="truncate">{section.label}</span>
                      {section.badge && (
                        <span className="ml-auto rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[0.68rem] text-sidebar-accent-foreground">
                          {section.badge}
                        </span>
                      )}
                    </SidebarGroupLabel>
                  )}
                  <SidebarGroupContent>
                    <SidebarMenu>
                      {section.items.map((item) => (
                        <NavItem
                          active={
                            activeItem
                              ? item.key === activeItem
                              : isActiveNavItem(item.href, pathname, hash)
                          }
                          item={item}
                          key={item.key}
                          onNavigate={onNavigate}
                        />
                      ))}
                    </SidebarMenu>
                  </SidebarGroupContent>
                </SidebarGroup>
              ))}
            </>
          )}
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <NotificationCenter />
            <ShellMenuItem
              active={pathname.startsWith("/settings")}
              href="/settings/account"
              icon="settings"
              label="设置"
            />
            <SidebarMenuItem>
              <SidebarMenuButton
                className="h-10"
                tooltip={user?.displayName ?? user?.email ?? "未登录"}
                type="button"
              >
                <UserAvatar size="sm" user={user} />
                <span className="grid min-w-0 flex-1 leading-tight">
                  <span className="truncate text-xs font-medium">
                    {user?.displayName ?? "未登录"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {user?.email ?? organizationName ?? "管理控制台"}
                  </span>
                </span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>

          {actions && (
            <div className="grid gap-2 px-1 group-data-[collapsible=icon]:hidden">
              {actions}
            </div>
          )}
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-auto">
        <div className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:hidden">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium">
            {organizationName ?? "管理控制台"}
          </span>
        </div>
        <main className={cn("min-w-0 bg-background", contentClassName ?? "px-4 py-8 md:px-5")}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

function readStoredSidebarState() {
  if (typeof window === "undefined") return null;

  const localValue = window.localStorage.getItem(MAIN_SIDEBAR_STATE_KEY);
  if (localValue === "true" || localValue === "false") {
    return localValue === "true";
  }

  const cookieValue = document.cookie
    .split("; ")
    .find((row) => row.startsWith(`${MAIN_SIDEBAR_STATE_KEY}=`))
    ?.split("=")[1];
  if (cookieValue === "true" || cookieValue === "false") {
    return cookieValue === "true";
  }

  return null;
}

function writeStoredSidebarState(open: boolean) {
  if (typeof window === "undefined") return;
  const value = String(open);
  window.localStorage.setItem(MAIN_SIDEBAR_STATE_KEY, value);
  document.cookie = `${MAIN_SIDEBAR_STATE_KEY}=${value}; path=/; max-age=${MAIN_SIDEBAR_COOKIE_MAX_AGE}`;
}

function ScopeSwitcher({
  canUsePlatformScope,
  currentOrganizationId,
  currentScopeLevel,
  onOrganizationSwitch,
  onPlatformScopeSwitch,
  organizationName,
  organizations,
}: {
  canUsePlatformScope: boolean;
  currentOrganizationId?: string | null;
  currentScopeLevel: RequestScopeLevel;
  onOrganizationSwitch?: (organizationId: string) => void | Promise<void>;
  onPlatformScopeSwitch?: () => void | Promise<void>;
  organizationName?: string | null;
  organizations: Organization[];
}) {
  const isPlatformScope = currentScopeLevel === "platform";
  const currentLabel = isPlatformScope
    ? "整个平台"
    : organizationName ?? "管理控制台";
  const canSwitch = canUsePlatformScope || organizations.length > 0;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canSwitch}>
            <SidebarMenuButton
              className="h-14 rounded-lg border bg-background/70 px-2 shadow-xs group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none"
              size="lg"
              tooltip={`当前范围：${currentLabel}`}
              type="button"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground group-data-[collapsible=icon]:bg-sidebar-accent group-data-[collapsible=icon]:text-sidebar-accent-foreground">
                <AppIcon className="size-4" name="building" />
              </span>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-[0.65rem] uppercase text-muted-foreground">
                  当前范围
                </span>
                <span className="truncate text-sm font-medium">
                  {currentLabel}
                </span>
              </span>
              <AppIcon
                className="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden"
                name="chevron-down"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>切换范围</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {canUsePlatformScope && (
              <>
                <DropdownMenuItem
                  className="items-start gap-2 py-2"
                  disabled={isPlatformScope || !onPlatformScopeSwitch}
                  onClick={() => {
                    if (!isPlatformScope) void onPlatformScopeSwitch?.();
                  }}
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                    <AppIcon className="size-4" name="server" />
                  </span>
                  <span className="grid min-w-0 flex-1 gap-0.5">
                    <span className="truncate text-sm font-medium">整个平台</span>
                    <span className="truncate text-xs text-muted-foreground">
                      租户管理与平台设置
                    </span>
                  </span>
                  {isPlatformScope && (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.68rem] text-muted-foreground">
                      当前
                    </span>
                  )}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            {organizations.length === 0 ? (
              <DropdownMenuItem disabled>暂无可切换组织</DropdownMenuItem>
            ) : (
              organizations.map((organization) => {
                const active = organization.id === currentOrganizationId;
                return (
                  <DropdownMenuItem
                    className="items-start gap-2 py-2"
                    disabled={active || !onOrganizationSwitch}
                    key={organization.id}
                    onClick={() => {
                      if (!active) void onOrganizationSwitch?.(organization.id);
                    }}
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                      <AppIcon className="size-4" name="building" />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {organization.name}
                      </span>
                      <span className="truncate text-xs text-muted-foreground">
                        {organization.slug}
                      </span>
                    </span>
                    {active && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.68rem] text-muted-foreground">
                        当前
                      </span>
                    )}
                  </DropdownMenuItem>
                );
              })
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function ShellMenuItem({
  active,
  href,
  icon,
  label,
}: {
  active: boolean;
  href?: string;
  icon: AppIconName;
  label: string;
}) {
  const content = (
    <>
      <AppIcon className="size-4 shrink-0" name={icon} />
      <span>{label}</span>
    </>
  );

  if (href) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} tooltip={label}>
          <Link href={href}>{content}</Link>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <SidebarMenuItem>
      <SidebarMenuButton isActive={active} tooltip={label} type="button">
        {content}
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

function NavItem({
  active,
  item,
  onNavigate,
}: {
  active: boolean;
  item: AppShellNavItem;
  onNavigate?: (item: AppShellNavItem) => void;
}) {
  const content = (
    <>
      <AppIcon className="size-4 shrink-0" name={item.icon ?? "users"} />
      <span>{item.label}</span>
    </>
  );

  return (
    <SidebarMenuItem>
      {onNavigate ? (
        <SidebarMenuButton
          isActive={active}
          onClick={() => onNavigate(item)}
          tooltip={item.label}
          type="button"
        >
          {content}
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton asChild isActive={active} tooltip={item.label}>
          <Link href={item.href}>{content}</Link>
        </SidebarMenuButton>
      )}
      {item.badge && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
    </SidebarMenuItem>
  );
}

function isActiveNavItem(href: string, pathname: string, hash: string) {
  const [path, itemHash] = href.split("#");
  if (path !== pathname) return false;
  if (!itemHash) return true;
  return hash === `#${itemHash}`;
}
