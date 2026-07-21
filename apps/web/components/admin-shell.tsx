"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useI18n } from "@/components/i18n-provider";
import { AppShell } from "@/components/app-shell";
import { RealtimeProvider } from "@/components/realtime-provider";
import { Button } from "@/components/ui/button";
import { PAGE_ACCESS_DEFINITIONS } from "@hermes-swarm/rbac-api";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import {
  fetchMe,
  isUnauthorizedApiError,
  listAccountContexts,
  switchAccountContext,
  type ContextSelectionOption,
  type Snapshot,
} from "@/lib/admin-api";
import { clearStoredSession, resolveSession, type ResolvedSession } from "@/lib/session";
import { hasPageAccess } from "@/lib/access-control";
import { resolvePlatformNameFromSettings } from "@/lib/platform-settings";
import { resolveLoginRoute, resolvePrincipalRoute } from "@/lib/principal-route";

type AdminShellContextValue = {
  loading: boolean;
  refreshSnapshot: () => Promise<void>;
  resolvedSession: ResolvedSession | null;
  snapshot: Snapshot | null;
};

const AdminShellContext = createContext<AdminShellContextValue | null>(null);

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations();
  const { setRuntimePreferences } = useI18n();
  const loadingSessionFailedMessageRef = useRef(
    t("shell.loadingSessionFailed"),
  );
  const pathnameRef = useRef(pathname);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [contextOptions, setContextOptions] = useState<ContextSelectionOption[]>([]);
  const [switchingContext, setSwitchingContext] = useState(false);
  const [redirectingToLogin, setRedirectingToLogin] = useState(false);

  useEffect(() => {
    loadingSessionFailedMessageRef.current = t("shell.loadingSessionFailed");
  }, [t]);

  pathnameRef.current = pathname;

  const loadSnapshot = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (options.showLoading ?? true) {
        setRedirectingToLogin(false);
        setLoading(true);
      }
      try {
        const principal = await fetchMe();
        setContextOptions(await listAccountContexts());
        setRuntimePreferences(principal.runtimePreferences);
        const data = createShellSnapshot(principal);
        setSnapshot(data);
        setResolvedSession(resolveSession(data));
        setLoadError(null);
        const redirectPath = resolvePrincipalRoute(
          principal.principalType,
          pathnameRef.current,
        );
        setRedirectingToLogin(Boolean(redirectPath));
        if (redirectPath) router.replace(redirectPath);
      } catch (error) {
        if (isUnauthorizedApiError(error)) {
          clearStoredSession();
          setSnapshot(null);
          setResolvedSession(null);
          setLoadError(null);
          setRedirectingToLogin(true);
          router.replace(resolveLoginRoute(pathnameRef.current));
          return;
        }
        setLoadError(
          error instanceof Error
            ? error.message
            : loadingSessionFailedMessageRef.current,
        );
        setRedirectingToLogin(false);
      } finally {
        setLoading(false);
      }
    },
    [router, setRuntimePreferences],
  );

  useEffect(() => {
    void loadSnapshot({ showLoading: true });
  }, [loadSnapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const redirectPath = resolvePrincipalRoute(snapshot.principalType, pathname);
    setRedirectingToLogin(Boolean(redirectPath));
    if (redirectPath) router.replace(redirectPath);
  }, [pathname, router, snapshot]);

  const contextValue = useMemo<AdminShellContextValue>(
    () => ({
      loading,
      refreshSnapshot: () => loadSnapshot({ showLoading: false }),
      resolvedSession,
      snapshot,
    }),
    [loadSnapshot, loading, resolvedSession, snapshot],
  );

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <div className="grid max-w-sm gap-3 text-center">
          <div className="text-sm font-medium">{t("shell.loadSessionFailed")}</div>
          <div className="text-xs text-muted-foreground">{loadError}</div>
          <Button
            className="mx-auto"
            onClick={() => loadSnapshot({ showLoading: true })}
            type="button"
            variant="outline"
          >
            {t("common.retry")}
          </Button>
        </div>
      </div>
    );
  }

  if (loading || redirectingToLogin) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-sm">{t("common.loading")}</span>
      </div>
    );
  }

  if (!snapshot || !resolvedSession) {
    return null;
  }

  const platformName = resolvePlatformName(
    snapshot,
    resolvedSession.user.preferredLanguage,
  );
  const navSections = buildMainNavSections(resolvedSession);
  const ticketAccess = buildTicketAccess(resolvedSession, snapshot);

  async function switchContext(option: ContextSelectionOption) {
    if (
      switchingContext ||
      option.membershipId === principalMembershipId(snapshot)
    ) {
      return;
    }
    setSwitchingContext(true);
    try {
      await switchAccountContext({
        contextType: option.type,
        membershipId: option.membershipId,
      });
      window.location.assign(option.type === "platform" ? "/platform/workspaces" : "/home");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : t("shell.loadSessionFailed"));
      setSwitchingContext(false);
    }
  }

  return (
    <RealtimeProvider
      connectionKey={`${snapshot.workspace?.id ?? "platform"}:${resolvedSession.user.id}`}
      enabled={snapshot.principalType === "workspace"}
    >
      <AppShell
      contentClassName={
        pathname.startsWith("/settings") ||
        pathname.startsWith("/platform/settings")
          ? "p-0"
          : undefined
      }
      homeHref={
        snapshot.principalType === "platform" ? "/platform" : "/home"
      }
      homeLabel={
        snapshot.principalType === "platform" ? t("shell.home") : undefined
      }
      onUserUpdated={() => loadSnapshot({ showLoading: false })}
      platformName={platformName}
      navSections={navSections}
      settingsHref={
        snapshot.principalType === "platform"
          ? "/platform/settings"
          : "/settings/account"
      }
      ticketAccess={ticketAccess}
      workspace={snapshot.permissions.includes("workspace.console.access:workspace") ? snapshot.workspace : null}
      contextOptions={contextOptions}
      switchingContext={switchingContext}
      onSwitchContext={(option) => void switchContext(option)}
      user={resolvedSession.user}
        >
        <AdminShellContext.Provider value={contextValue}>
          {children}
        </AdminShellContext.Provider>
      </AppShell>
    </RealtimeProvider>
  );
}

export function useAdminShell() {
  const context = useContext(AdminShellContext);
  if (!context) {
    throw new Error("useAdminShell must be used inside AdminShell.");
  }
  return context;
}

function resolvePlatformName(
  snapshot: Snapshot,
  preferredLanguage?: string | null,
) {
  return resolvePlatformNameFromSettings(
    snapshot.systemSettings,
    preferredLanguage,
  );
}

export function createShellSnapshot(
  principal: Awaited<ReturnType<typeof fetchMe>>,
): Snapshot {
  if (principal.principalType === "platform") {
    const roles = principal.role ? [principal.role] : [];
    const permissions = principal.permissions;
    const user = principal.account;
    const isPlatformAdmin =
      roles.some((role) => role.name === "platform-admin") ||
      hasPlatformManagementPermission(permissions);

    return {
      ...principal,
      currentUser: {
        isPlatformAdmin,
        permissions,
        principalType: "platform",
        role: roles[0] ?? null,
        user,
      },
      isPlatformAdmin,
      permissions,
      principalType: "platform",
      role: roles[0] ?? null,
      rolePermissions: roles.flatMap((role) => role.permissions ?? []),
      roles,
      systemSettings: principal.systemSettings ?? [],
      workspace: null,
      workspaceId: null,
      user,
      users: [],
    };
  }

  const role = principal.workspaceRole ?? null;
  const activePermissions = principal.permissions;
  const isPlatformAdmin = false;

  return {
    ...principal,
      currentUser: {
      isPlatformAdmin,
      permissions: activePermissions,
      principalType: "workspace",
      role,
      user: principal.account,
    },
    isPlatformAdmin,
    permissions: activePermissions,
    rolePermissions: role?.permissions ?? [],
    roles: role ? [role] : [],
    systemSettings: principal.systemSettings ?? [],
    user: principal.account,
    users: [],
  };
}

function principalMembershipId(snapshot: Snapshot | null) {
  return snapshot && "context" in snapshot
    ? snapshot.context?.membershipId
    : undefined;
}

function hasPlatformManagementPermission(permissions: string[] | undefined) {
  return Boolean(
    permissions?.some((permission) => permission.endsWith(":platform")),
  );
}

function buildMainNavSections(resolvedSession: ResolvedSession) {
  if (resolvedSession.principalType === "platform") {
    const items = PAGE_ACCESS_DEFINITIONS.filter(
      (page) =>
        page.section === "platform" &&
        page.key !== "platform.audit" &&
        hasPageAccess(resolvedSession, page.key),
    ).map((page) => ({
      href: page.href,
      icon: page.icon as any,
      key: page.key,
      label: page.label,
    }));
    return items.length > 0
      ? [
          {
            items,
            key: "platform",
            label: "平台控制面",
            order: 1,
          },
        ]
      : [];
  }

  const sections = new Map<
    string,
    {
      items: Array<{
        href: string;
        icon?: any;
        key: string;
        label: string;
      }>;
      key: string;
      label: string;
      order: number;
    }
  >();

  for (const page of PAGE_ACCESS_DEFINITIONS) {
    if (page.section !== "business") continue;
    if (!hasPageAccess(resolvedSession, page.key)) continue;
    const section = sections.get(page.section) ?? {
      items: [],
      key: page.section,
      label: page.sectionLabel ?? "业务",
      order: 1000,
    };
    if (section.items.some((item) => item.href === page.href)) continue;
    section.items.push({
      href: page.href,
      icon: page.icon,
      key: page.key,
      label: page.label,
    });
    section.order = Math.min(section.order, page.order ?? 1000);
    sections.set(page.section, section);
  }

  return [...sections.values()]
    .sort((left, right) => left.order - right.order || left.label.localeCompare(right.label))
    .map((section) => ({
      items: section.items.sort((left, right) => left.label.localeCompare(right.label)),
      key: section.key,
      label: section.label,
    }));
}

function buildTicketAccess(
  resolvedSession: ResolvedSession,
  snapshot: Snapshot,
) {
  if (!getPlatformBooleanSetting(snapshot, PLATFORM_SETTING_KEYS.ticketingVisible, true)) {
    return { visible: false };
  }

  const canOpenTickets =
    hasPageAccess(resolvedSession, "tickets") ||
    hasPageAccess(resolvedSession, "tickets.workspace") ||
    resolvedSession.permissions.includes(
      "ticket.workspace_conversation.list_workspace:own",
    );

  return { visible: canOpenTickets };
}

function getPlatformBooleanSetting(
  snapshot: Snapshot,
  name: string,
  fallback: boolean,
) {
  const value = snapshot.systemSettings?.find((setting) => setting.name === name)?.value;
  if (value === "true") return true;
  if (value === "false") return false;
  return fallback;
}
