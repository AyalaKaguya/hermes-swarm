"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { NotificationCenter } from "@/components/notification-center";
import { UserMenu, type UserMenuTicketAccess } from "@/components/user-menu";
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
  SidebarSeparator,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import type { Organization, User } from "@/lib/admin-api";
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
  currentOrganizationId,
  footerNavItems,
  navSections,
  onNavigate,
  onOrganizationSwitch,
  onUserUpdated,
  organizationName,
  organizations,
  platformName,
  ticketAccess,
  user,
}: {
  actions?: ReactNode;
  activeItem?: string;
  children: ReactNode;
  contentClassName?: string;
  currentOrganizationId?: string | null;
  footerNavItems?: AppShellNavItem[];
  navSections?: AppShellNavSection[];
  onNavigate?: (item: AppShellNavItem) => void;
  onOrganizationSwitch?: (organizationId: string) => void | Promise<void>;
  onUserUpdated?: () => Promise<void>;
  organizationName?: string | null;
  organizations?: Organization[];
  platformName?: string | null;
  ticketAccess?: UserMenuTicketAccess | null;
  user?: User | null;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const [mainSidebarOpen, setMainSidebarOpen] = useState(false);
  const sections = navSections ?? [];
  const footerItems = footerNavItems ?? [];
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

  useEffect(() => {
    document.title = `${shellTitle} Console`;
  }, [shellTitle]);

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
      <Sidebar collapsible="icon" className="border-r-0">
        <SidebarHeader className="gap-2 p-2">
          <div className="flex min-h-10 items-center gap-2">
            <Link
              className="min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm font-semibold outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring group-data-[collapsible=icon]:hidden"
              href="/home"
            >
              {shellTitle}
            </Link>
            <SidebarTrigger className="size-8 shrink-0" />
          </div>

          <ScopeSwitcher
            currentOrganizationId={currentOrganizationId}
            onOrganizationSwitch={onOrganizationSwitch}
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
                        <span className="ml-auto rounded-md bg-sidebar-accent px-1.5 py-0.5 text-[0.68rem]">
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
          <SidebarMenu className="group-data-[collapsible=icon]:items-center">
            <NotificationCenter />
            {footerItems.map((item) => (
              <NavItem
                active={isActiveNavItem(item.href, pathname, hash)}
                item={item}
                key={item.key}
                onNavigate={onNavigate}
              />
            ))}
            <ShellMenuItem
              active={pathname.startsWith("/settings")}
              href="/settings/account"
              icon="settings"
              label="设置"
            />
            <UserMenu
              onUserUpdated={onUserUpdated}
              organizationName={organizationName}
              ticketAccess={ticketAccess}
              user={user}
            />
          </SidebarMenu>

          {actions && (
            <div className="grid gap-2 px-1 group-data-[collapsible=icon]:hidden">
              {actions}
            </div>
          )}
        </SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 overflow-auto">
        <div className="sticky top-0 z-10 flex h-12 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur md:hidden">
          <SidebarTrigger />
          <span className="truncate text-sm font-medium">
            {organizationName ?? "管理控制台"}
          </span>
        </div>
        <main
          className={cn(
            "min-w-0 bg-background",
            contentClassName ?? "px-4 py-8 md:px-5",
          )}
        >
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
  currentOrganizationId,
  onOrganizationSwitch,
  organizationName,
  organizations,
}: {
  currentOrganizationId?: string | null;
  onOrganizationSwitch?: (organizationId: string) => void | Promise<void>;
  organizationName?: string | null;
  organizations: Organization[];
}) {
  const currentLabel = organizationName ?? "管理控制台";
  const canSwitch = organizations.length > 0;

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild disabled={!canSwitch}>
            <SidebarMenuButton
              className="h-14 rounded-lg border bg-background/70 px-2 shadow-xs group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none"
              size="lg"
              tooltip={`当前组织：${currentLabel}`}
              type="button"
            >
              <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted group-data-[collapsible=icon]:bg-sidebar-accent">
                <AppIcon className="size-4" name="building" />
              </span>
              <span className="grid min-w-0 flex-1 leading-tight">
                <span className="truncate text-[0.65rem] uppercase">
                  当前组织
                </span>
                <span className="truncate text-sm font-medium">
                  {currentLabel}
                </span>
              </span>
              <AppIcon
                className="size-4 group-data-[collapsible=icon]:hidden"
                name="chevron-down"
              />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-72">
            <DropdownMenuLabel>切换组织</DropdownMenuLabel>
            <DropdownMenuSeparator />
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
                    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted">
                      <AppIcon className="size-4" name="building" />
                    </span>
                    <span className="grid min-w-0 flex-1 gap-0.5">
                      <span className="truncate text-sm font-medium">
                        {organization.name}
                      </span>
                      <span className="truncate text-xs">
                        {organization.slug}
                      </span>
                    </span>
                    {active && (
                      <span className="rounded-md bg-muted px-1.5 py-0.5 text-[0.68rem]">
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
