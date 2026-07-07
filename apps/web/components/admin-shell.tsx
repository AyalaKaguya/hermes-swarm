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
import { AppShell } from "@/components/app-shell";
import { PAGE_ACCESS_DEFINITIONS } from "@hermes-swarm/rbac-api";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import {
  fetchMe,
  getUsableStoredSession,
  isUnauthorizedApiError,
  type Snapshot,
} from "@/lib/admin-api";
import {
  clearStoredSession,
  resolveSession,
  storeSession,
  type ResolvedSession,
} from "@/lib/session";
import { hasPageAccess } from "@/lib/access-control";
import { resolvePlatformNameFromSettings } from "@/lib/platform-settings";

type AdminShellContextValue = {
  loading: boolean;
  refreshSnapshot: () => Promise<void>;
  resolvedSession: ResolvedSession | null;
  snapshot: Snapshot | null;
};

const AdminShellContext = createContext<AdminShellContextValue | null>(null);

const PUBLIC_PATHS = ["/login", "/onboarding"];

export function AdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const t = useTranslations();
  const loadingSessionFailedMessageRef = useRef(
    t("shell.loadingSessionFailed"),
  );
  const isPublicRoute = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(!isPublicRoute);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [redirectingToLogin, setRedirectingToLogin] = useState(false);

  useEffect(() => {
    loadingSessionFailedMessageRef.current = t("shell.loadingSessionFailed");
  }, [t]);

  const loadSnapshot = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const session = await getUsableStoredSession().catch(() => null);

      if (!session?.accessToken) {
        setSnapshot(null);
        setResolvedSession(null);
        setLoadError(null);
        setRedirectingToLogin(true);
        setLoading(false);
        router.replace("/login");
        return;
      }

      if (options.showLoading ?? true) {
        setRedirectingToLogin(false);
        setLoading(true);
      }
      try {
        const principal = await fetchMe(session.accessToken);
        const data = createShellSnapshot(principal);
        setSnapshot(data);
        setResolvedSession(resolveSession(data));
        setLoadError(null);
        setRedirectingToLogin(false);
      } catch (error) {
        if (isUnauthorizedApiError(error)) {
          clearStoredSession();
          setSnapshot(null);
          setResolvedSession(null);
          setLoadError(null);
          setRedirectingToLogin(true);
          router.replace("/login");
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
    [router],
  );

  useEffect(() => {
    if (isPublicRoute) {
      setRedirectingToLogin(false);
      setLoading(false);
      return;
    }

    void loadSnapshot({ showLoading: true });
  }, [isPublicRoute, loadSnapshot]);

  async function switchOrganization(organizationId: string) {
    const session = await getUsableStoredSession().catch(() => null);
    if (!session?.accessToken || organizationId === snapshot?.organization?.id) {
      return;
    }
    const principal = await fetchMe(session.accessToken);
    const result = createShellSnapshot(principal, organizationId);
    storeSession(session);
    setSnapshot(result);
    setResolvedSession(resolveSession(result));
    if (pathname.startsWith("/settings/organizations/")) {
      router.replace(`/settings/organizations/${organizationId}`);
    }
  }

  const contextValue = useMemo<AdminShellContextValue>(
    () => ({
      loading,
      refreshSnapshot: () => loadSnapshot({ showLoading: false }),
      resolvedSession,
      snapshot,
    }),
    [loadSnapshot, loading, resolvedSession, snapshot],
  );

  if (isPublicRoute) {
    return children;
  }

  if (loadError) {
    return (
      <div className="flex h-screen items-center justify-center p-4">
        <div className="grid max-w-sm gap-3 text-center">
          <div className="text-sm font-medium">{t("shell.loadSessionFailed")}</div>
          <div className="text-xs text-muted-foreground">{loadError}</div>
          <button
            className="mx-auto h-8 rounded-md border px-3 text-sm transition-colors hover:bg-muted"
            onClick={() => loadSnapshot({ showLoading: true })}
            type="button"
          >
            {t("common.retry")}
          </button>
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

  return (
    <AppShell
      contentClassName={pathname.startsWith("/settings") ? "p-0" : undefined}
      currentOrganizationId={snapshot.organization?.id}
      onOrganizationSwitch={switchOrganization}
      onUserUpdated={() => loadSnapshot({ showLoading: false })}
      organizationName={
        snapshot.organization?.name ?? resolvedSession.organization?.name
      }
      organizations={snapshot.organizations}
      platformName={platformName}
      navSections={navSections}
      ticketAccess={ticketAccess}
      user={resolvedSession.user}
    >
      <AdminShellContext.Provider value={contextValue}>
        {children}
      </AdminShellContext.Provider>
    </AppShell>
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

function createShellSnapshot(
  principal: Awaited<ReturnType<typeof fetchMe>>,
  preferredOrganizationId?: string,
): Snapshot {
  const memberships = principal.memberships ?? [];
  const organizations = memberships
    .map((membership) => membership.organization)
    .filter((organization): organization is NonNullable<typeof organization> =>
      Boolean(organization),
    );
  const activeMembership =
    memberships.find(
      (membership) => membership.organizationId === preferredOrganizationId,
    ) ??
    memberships[0] ??
    null;
  const organization = activeMembership?.organization ?? organizations[0] ?? null;
  const role = activeMembership?.role ?? principal.platformMembership?.role ?? null;
  const activePermissions = resolveActivePermissions(principal, activeMembership);
  const isPlatformAdmin = hasPlatformManagementPermission(activePermissions);

  return {
    ...principal,
    currentUser: {
      isPlatformAdmin,
      memberships,
      organization,
      permissions: activePermissions,
      platformMembership: principal.platformMembership,
      role,
      user: principal.user,
    },
    isPlatformAdmin,
    organization,
    organizations,
    permissions: activePermissions,
    rolePermissions: role?.permissions ?? [],
    roles: role ? [role] : [],
    scope: {
      level: organization ? "organization" : "platform",
      organizationId: organization?.id ?? null,
    },
    settings: [],
    systemSettings: principal.systemSettings ?? [],
    users: [],
  };
}

function resolveActivePermissions(
  principal: Awaited<ReturnType<typeof fetchMe>>,
  activeMembership: Awaited<ReturnType<typeof fetchMe>>["memberships"][number] | null,
) {
  const permissionSources = [
    activeMembership?.role?.permissions,
    principal.platformMembership?.role?.permissions,
  ].filter((items): items is NonNullable<typeof items> => Array.isArray(items));

  if (permissionSources.length === 0) {
    return principal.permissions;
  }

  return [
    ...new Set(
      permissionSources
        .flat()
        .filter((permission) => permission.enabled)
        .map((permission) => permission.permission),
    ),
  ];
}

function hasPlatformManagementPermission(permissions: string[] | undefined) {
  return Boolean(
    permissions?.some((permission) => permission.endsWith(":platform")),
  );
}

function buildMainNavSections(resolvedSession: ResolvedSession) {
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
    hasPageAccess(resolvedSession, "tickets.platform") ||
    resolvedSession.permissions.includes(
      "ticket.platform_conversation.list_platform:platform",
    ) ||
    Boolean(
      snapshot.memberships?.some(
        (membership) => membership.role?.name === "owner",
      ),
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
