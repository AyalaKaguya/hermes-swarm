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
  getSnapshot,
  switchOrganizationScope,
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

  const loadSnapshot = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      const session = getStoredSession();
      if (!session?.token) {
        setSnapshot(null);
        setResolvedSession(null);
        setLoading(false);
        router.replace("/login");
        return;
      }

      if (options.showLoading ?? true) {
        setLoading(true);
      }
      try {
        const data = await getSnapshot(session.token);
        setSnapshot(data);
        setResolvedSession(resolveSession(data));
      } catch {
        clearStoredSession();
        setSnapshot(null);
        setResolvedSession(null);
        router.replace("/login");
      } finally {
        setLoading(false);
      }
    },
    [router],
  );

  useEffect(() => {
    if (isPublicRoute) {
      setLoading(false);
      return;
    }

    void loadSnapshot({ showLoading: true });
  }, [isPublicRoute, loadSnapshot]);

  async function switchOrganization(organizationId: string) {
    const session = getStoredSession();
    if (!session?.token || organizationId === snapshot?.organization.id) {
      return;
    }
    const result = await switchOrganizationScope(session.token, organizationId);
    storeSession({ token: result.token });
    setSnapshot(result.snapshot);
    setResolvedSession(resolveSession(result.snapshot));
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

  if (loading || !snapshot || !resolvedSession) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-sm">加载中...</span>
      </div>
    );
  }

  const platformName = resolvePlatformName(
    snapshot,
    resolvedSession.user.preferredLanguage,
  );

  return (
    <AppShell
      contentClassName={pathname.startsWith("/settings") ? "p-0" : undefined}
      currentOrganizationId={snapshot.organization.id}
      onOrganizationSwitch={switchOrganization}
      onUserUpdated={() => loadSnapshot({ showLoading: false })}
      organizationName={
        snapshot.organization.name ?? resolvedSession.organization?.name
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
    ? `tenant_title_${preferredLanguage}`
    : "";
  return (
    settings.find((setting) => setting.name === languageKey)?.value?.trim() ||
    settings
      .find((setting) => setting.name === "tenant_title")
      ?.value?.trim() ||
    null
  );
}
