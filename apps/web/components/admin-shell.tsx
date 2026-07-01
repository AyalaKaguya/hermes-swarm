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
  const [redirectingToLogin, setRedirectingToLogin] = useState(false);

  const loadSnapshot = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const session = getStoredSession();
      if (!session?.token) {
        setSnapshot(null);
        setResolvedSession(null);
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
        const principal = await fetchMe(session.token);
        const data = createShellSnapshot(principal);
        setSnapshot(data);
        setResolvedSession(resolveSession(data));
        setRedirectingToLogin(false);
      } catch {
        clearStoredSession();
        setSnapshot(null);
        setResolvedSession(null);
        setRedirectingToLogin(true);
        router.replace("/login");
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
    if (!session?.token || organizationId === snapshot?.organization?.id) {
      return;
    }
    const principal = await fetchMe(session.token);
    const result = createShellSnapshot(principal, organizationId);
    storeSession({ token: session.token });
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
  const isPlatformAdmin = Boolean(principal.platformMembership);

  return {
    ...principal,
    currentUser: {
      isPlatformAdmin,
      memberships,
      organization,
      permissions: principal.permissions,
      platformMembership: principal.platformMembership,
      role,
      user: principal.user,
    },
    isPlatformAdmin,
    organization,
    organizations,
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
