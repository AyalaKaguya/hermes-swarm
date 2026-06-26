"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { AppIcon, type AppIconName } from "@/components/app-icon";
import { UserAvatar } from "@/components/user-avatar";
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
import type { User } from "@/lib/admin-api";

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
  navSections,
  onNavigate,
  organizationName,
  user,
}: {
  actions?: ReactNode;
  activeItem?: string;
  children: ReactNode;
  navSections?: AppShellNavSection[];
  onNavigate?: (item: AppShellNavItem) => void;
  organizationName?: string | null;
  user?: User | null;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const sections = navSections ?? [];

  useEffect(() => {
    function syncHash() {
      setHash(window.location.hash);
    }

    syncHash();
    window.addEventListener("hashchange", syncHash);
    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  return (
    <SidebarProvider
      defaultOpen={false}
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
              Hermes Swarm
            </Link>
            <SidebarTrigger className="size-8 shrink-0" />
          </div>

          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                className="h-14 rounded-lg border bg-background/70 px-2 shadow-xs group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none"
                size="lg"
                tooltip={`组织范围：${organizationName ?? "管理控制台"}`}
              >
                <Link href="/settings/organizations">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground group-data-[collapsible=icon]:bg-sidebar-accent group-data-[collapsible=icon]:text-sidebar-accent-foreground">
                    <AppIcon className="size-4" name="building" />
                  </span>
                  <span className="grid min-w-0 flex-1 leading-tight">
                    <span className="truncate text-[0.65rem] uppercase text-muted-foreground">
                      当前范围
                    </span>
                    <span className="truncate text-sm font-medium">
                      {organizationName ?? "管理控制台"}
                    </span>
                  </span>
                  <AppIcon
                    className="size-4 text-muted-foreground group-data-[collapsible=icon]:hidden"
                    name="chevron-down"
                  />
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
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
            <ShellMenuItem active={false} icon="bell" label="通知" />
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
        <main className="min-w-0 bg-background px-4 py-8 md:px-5">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
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
