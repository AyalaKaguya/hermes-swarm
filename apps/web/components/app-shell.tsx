"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
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
import { useTextTranslation } from "@/hooks/use-text-translation";
import type {
  Workspace,
  User,
  ContextSelectionOption,
} from "@/lib/admin-api";
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
  footerNavItems,
  homeHref,
  homeLabel,
  navSections,
  onNavigate,
  onSwitchContext,
  onUserUpdated,
  platformName,
  platformSlogan,
  settingsHref,
  ticketAccess,
  workspace,
  contextOptions,
  switchingContext,
  user,
}: {
  actions?: ReactNode;
  activeItem?: string;
  children: ReactNode;
  contentClassName?: string;
  footerNavItems?: AppShellNavItem[];
  homeHref?: string;
  homeLabel?: string;
  navSections?: AppShellNavSection[];
  onNavigate?: (item: AppShellNavItem) => void;
  onSwitchContext?: (option: ContextSelectionOption) => void;
  onUserUpdated?: () => Promise<void>;
  platformName?: string | null;
  platformSlogan?: string | null;
  settingsHref?: string | null;
  ticketAccess?: UserMenuTicketAccess | null;
  workspace?: Workspace | null;
  contextOptions?: ContextSelectionOption[];
  switchingContext?: boolean;
  user?: User | null;
}) {
  const pathname = usePathname();
  const [hash, setHash] = useState("");
  const [mainSidebarOpen, setMainSidebarOpen] = useState(false);
  const t = useTranslations();
  const tr = useTextTranslation();
  const sections = navSections ?? [];
  const footerItems = footerNavItems ?? [];
  const shellTitle = platformName?.trim() || "Hermes Swarm";
  const resolvedHomeHref = homeHref ?? "/home";

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
    document.title = t("shell.documentTitle", { name: shellTitle });
  }, [shellTitle, t]);

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
              href={resolvedHomeHref}
            >
              {shellTitle}
            </Link>
            <SidebarTrigger className="size-8 shrink-0" />
          </div>

          <WorkspaceIdentity
            onSwitchContext={onSwitchContext}
            options={contextOptions}
            platformName={shellTitle}
            platformSlogan={platformSlogan}
            switching={switchingContext}
            workspace={workspace}
          />
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <ShellMenuItem
                  active={pathname === resolvedHomeHref}
                  href={resolvedHomeHref}
                  icon="home"
                  label={homeLabel ?? t("shell.home")}
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
                      <span className="truncate">{tr(section.label)}</span>
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
            {settingsHref !== null && (
              <ShellMenuItem
                active={pathname.startsWith(settingsHref ?? "/settings")}
                href={settingsHref ?? "/settings/account"}
                icon="settings"
                label={t("shell.settings")}
              />
            )}
            <UserMenu
              onUserUpdated={onUserUpdated}
              ticketAccess={ticketAccess}
              user={user}
              workspaceName={workspace?.name}
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
            {workspace?.name ?? t("shell.console")}
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

function WorkspaceIdentity({
  onSwitchContext,
  options = [],
  platformName,
  platformSlogan,
  switching,
  workspace,
}: {
  onSwitchContext?: (option: ContextSelectionOption) => void;
  options?: ContextSelectionOption[];
  platformName?: string | null;
  platformSlogan?: string | null;
  switching?: boolean;
  workspace?: Workspace | null;
}) {
  const t = useTranslations();
  const currentType = workspace ? "workspace" : "platform";
  const platformContextLabel = platformSlogan?.trim() || t("auth.console");
  const platformDisplayName = platformName?.trim() || "Hermes Swarm";
  const currentName = workspace?.name ?? platformDisplayName;

  const button = (
    <SidebarMenu>
      <SidebarMenuItem>
        <SidebarMenuButton
          className="h-14 rounded-lg border bg-background/70 px-2 shadow-xs group-data-[collapsible=icon]:size-9! group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:shadow-none"
          size="lg"
          tooltip={currentName}
          type="button"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted group-data-[collapsible=icon]:bg-sidebar-accent">
            <AppIcon className="size-4" name={workspace ? "building" : "shield"} />
          </span>
          <span className="grid min-w-0 flex-1 leading-tight">
            <span className="truncate text-[0.65rem] uppercase">
              {workspace
                ? t("workspaceScope.workspaceConsole")
                : platformContextLabel}
            </span>
            <span className="truncate text-sm font-medium">{currentName}</span>
          </span>
          {options.length > 1 && (
            <AppIcon className="size-3.5 text-muted-foreground group-data-[collapsible=icon]:hidden" name="chevron-down" />
          )}
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
  if (options.length <= 1 || !onSwitchContext) return button;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={switching}>
        {button}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64">
        <DropdownMenuLabel>{t("auth.switchWorkspace")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => (
          <DropdownMenuItem
            disabled={
              option.type === currentType &&
              (option.type === "platform" || option.workspace.id === workspace?.id)
            }
            key={`${option.type}:${option.membershipId}`}
            onSelect={() => onSwitchContext(option)}
          >
            <AppIcon className="size-4" name={option.type === "platform" ? "shield" : "building"} />
            <span className="grid min-w-0 flex-1">
              <span className="truncate">
                {option.type === "platform"
                  ? platformContextLabel
                  : option.workspace.name}
              </span>
              <span className="truncate text-xs text-muted-foreground">
                {option.role.displayName}
              </span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
  const tr = useTextTranslation();
  const label = tr(item.label);
  const content = (
    <>
      <AppIcon className="size-4 shrink-0" name={item.icon ?? "users"} />
      <span>{label}</span>
    </>
  );

  return (
    <SidebarMenuItem>
      {onNavigate ? (
        <SidebarMenuButton
          isActive={active}
          onClick={() => onNavigate(item)}
          tooltip={label}
          type="button"
        >
          {content}
        </SidebarMenuButton>
      ) : (
        <SidebarMenuButton asChild isActive={active} tooltip={label}>
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
