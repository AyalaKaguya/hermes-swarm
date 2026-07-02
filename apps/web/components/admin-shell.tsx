"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import {
  fetchMe,
  isUnauthorizedApiError,
  refreshAuthSession,
  type Snapshot,
} from "@/lib/admin-api";
import {
  clearStoredSession,
  getStoredSession,
  resolveSession,
  storeSession,
  type ResolvedSession,
} from "@/lib/session";

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
  const isPublicRoute = PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(!isPublicRoute);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [redirectingToLogin, setRedirectingToLogin] = useState(false);

  const loadSnapshot = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      let session = getStoredSession();
      if (!session?.accessToken) {
        const refreshed = await refreshAuthSession().catch(() => null);
        session = refreshed
          ? {
              accessToken: refreshed.accessToken,
              expiresAt: refreshed.expiresAt,
              sessionId: refreshed.sessionId,
            }
          : null;
      }

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
        setLoadError(error instanceof Error ? error.message : "加载登录状态失败");
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
    const session = getStoredSession();
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
          <div className="text-sm font-medium">无法加载当前登录状态</div>
          <div className="text-xs text-muted-foreground">{loadError}</div>
          <button
            className="mx-auto h-8 rounded-md border px-3 text-sm transition-colors hover:bg-muted"
            onClick={() => loadSnapshot({ showLoading: true })}
            type="button"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (loading || redirectingToLogin) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-sm">加载中...</span>
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
  const settings = snapshot.systemSettings ?? [];
  const languageKey = preferredLanguage
    ? `platform.title.${preferredLanguage}`
    : "";
  return (
    settings.find((setting) => setting.name === languageKey)?.value?.trim() ||
    settings
      .find((setting) => setting.name === "platform.title")
      ?.value?.trim() ||
    null
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
    systemSettings: [],
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
