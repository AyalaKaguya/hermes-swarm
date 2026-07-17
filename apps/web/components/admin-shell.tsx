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
import { RealtimeProvider } from "@/components/realtime-provider";
import { Button } from "@/components/ui/button";
import {
  OrganizationContextProvider,
  useOrganizationContext,
} from "@/components/organization-context-provider";
import { PAGE_ACCESS_DEFINITIONS } from "@hermes-swarm/rbac-api";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import {
  fetchMe,
  isUnauthorizedApiError,
  type Role,
  type Snapshot,
} from "@/lib/admin-api";
import { clearStoredSession, resolveSession, type ResolvedSession } from "@/lib/session";
import { hasPageAccess } from "@/lib/access-control";
import { resolveHostOrganizationIdFromPrincipal } from "@/lib/host-organization";
import { resolvePlatformNameFromSettings } from "@/lib/platform-settings";
import { resolvePrincipalRoute } from "@/lib/principal-route";
import {
  commitOrganizationSelection,
  initializeOrganizationSelection,
  resolveInitialOrganizationSelection,
} from "@/lib/organization-context";

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
  const loadingSessionFailedMessageRef = useRef(
    t("shell.loadingSessionFailed"),
  );
  const pathnameRef = useRef(pathname);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
        const initialSelection =
          principal.principalType === "tenant"
            ? resolveInitialOrganizationSelection(principal)
            : null;
        initializeOrganizationSelection(initialSelection);
        const data = createShellSnapshot(
          principal,
          initialSelection?.activeOrganizationId ?? undefined,
        );
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
    void loadSnapshot({ showLoading: true });
  }, [loadSnapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const redirectPath = resolvePrincipalRoute(snapshot.principalType, pathname);
    setRedirectingToLogin(Boolean(redirectPath));
    if (redirectPath) router.replace(redirectPath);
  }, [pathname, router, snapshot]);

  async function switchOrganization(organizationId: string | null) {
    const currentSnapshot = snapshot;
    if (!currentSnapshot || currentSnapshot.principalType !== "tenant") {
      return;
    }
    commitOrganizationSelection(currentSnapshot, organizationId);
    const result = selectSnapshotOrganization(currentSnapshot, organizationId);
    setSnapshot(result);
    setResolvedSession(resolveSession(result));
    if (pathname.startsWith("/settings")) {
      router.replace(
        organizationId ? "/settings/organization" : "/settings/tenant",
      );
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

  return (
    <OrganizationContextProvider principal={snapshot}>
      <RealtimeProvider
        connectionKey={`${snapshot.tenant?.id ?? "platform"}:${resolvedSession.user.id}`}
        enabled={snapshot.principalType === "tenant"}
      >
        <AppShell
      contentClassName={pathname.startsWith("/settings") ? "p-0" : undefined}
      currentOrganizationId={snapshot.organization?.id}
      homeHref={
        snapshot.principalType === "platform" ? "/platform/tenants" : "/home"
      }
      homeLabel={
        snapshot.principalType === "platform"
          ? t("platform.tenantApplications")
          : undefined
      }
      onOrganizationSwitch={switchOrganization}
      onUserUpdated={() => loadSnapshot({ showLoading: false })}
      organizationName={
        snapshot.organization?.name ?? resolvedSession.organization?.name
      }
      organizations={snapshot.organizations}
      platformName={platformName}
      navSections={navSections}
      settingsHref={
        snapshot.principalType === "platform"
          ? "/platform/settings"
          : "/settings/account"
      }
      ticketAccess={ticketAccess}
      tenant={snapshot.permissions.includes("workspace.console.access:tenant") ? snapshot.tenant : null}
      user={resolvedSession.user}
        >
          <AdminShellContext.Provider value={contextValue}>
            <OrganizationEpochBoundary>{children}</OrganizationEpochBoundary>
          </AdminShellContext.Provider>
        </AppShell>
      </RealtimeProvider>
    </OrganizationContextProvider>
  );
}

function OrganizationEpochBoundary({ children }: { children: ReactNode }) {
  useOrganizationContext();
  return (
    <div className="contents">{children}</div>
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
  preferredOrganizationId?: string,
): Snapshot {
  if (principal.principalType === "platform") {
    const roles = principal.platformUser.roles ?? [];
    const permissions = resolvePlatformPermissions(roles);
    const user = platformUserToDisplayUser(principal.platformUser);
    const isPlatformAdmin =
      roles.some((role) => role.name === "platform-admin") ||
      hasPlatformManagementPermission(permissions);

    return {
      ...principal,
      currentUser: {
        isPlatformAdmin,
        memberships: [],
        organization: null,
        permissions,
        platformUser: principal.platformUser,
        principalType: "platform",
        role: roles[0] ?? null,
        user,
      },
      isPlatformAdmin,
      memberships: [],
      organization: null,
      organizations: [],
      permissions,
      platformUser: principal.platformUser,
      principalType: "platform",
      role: roles[0] ?? null,
      rolePermissions: roles.flatMap((role) => role.permissions ?? []),
      roles,
      systemSettings: principal.systemSettings ?? [],
      tenant: null,
      tenantId: null,
      user,
      users: [],
    };
  }

  const memberships = principal.memberships ?? [];
  const organizations = memberships
    .map((membership) => membership.organization)
    .filter((organization): organization is NonNullable<typeof organization> =>
      Boolean(organization),
    );
  const hostOrganizationId =
    preferredOrganizationId ?? resolveHostOrganizationId(principal);
  const activeMembership =
    memberships.find(
      (membership) => membership.organizationId === hostOrganizationId,
    ) ??
    memberships[0] ??
    null;
  const organization = activeMembership?.organization ?? organizations[0] ?? null;
  const role = activeMembership?.role ?? principal.tenantRole ?? null;
  const activePermissions = resolveTenantPermissions(
    principal.permissions,
    activeMembership?.role ?? null,
  );
  const isPlatformAdmin = false;

  return {
    ...principal,
    currentUser: {
      isPlatformAdmin,
      memberships,
      organization,
      permissions: activePermissions,
      platformUser: null,
      principalType: "tenant",
      role,
      user: principal.user,
    },
    isPlatformAdmin,
    organization,
    organizations,
    permissions: activePermissions,
    rolePermissions: role?.permissions ?? [],
    roles: role ? [role] : [],
    systemSettings: principal.systemSettings ?? [],
    users: [],
  };
}

function resolveHostOrganizationId(principal: Awaited<ReturnType<typeof fetchMe>>) {
  if (principal.principalType !== "tenant") return null;
  if (typeof window === "undefined") return null;
  return resolveHostOrganizationIdFromPrincipal(
    principal,
    window.location.hostname,
  );
}

function selectSnapshotOrganization(
  snapshot: Snapshot,
  organizationId: string | null,
): Snapshot {
  if (!organizationId) {
    const role = snapshot.tenantRole ?? null;
    const permissions = snapshot.currentUser.permissions.filter((permission) =>
      !permission.endsWith(":organization"),
    );
    return {
      ...snapshot,
      currentUser: { ...snapshot.currentUser, organization: null, permissions, role },
      organization: null,
      permissions,
      role,
      rolePermissions: role?.permissions ?? [],
      roles: role ? [role] : [],
    };
  }
  const activeMembership =
    snapshot.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === "active",
    ) ?? null;
  if (!activeMembership?.organization) return snapshot;
  const role = activeMembership.role ?? null;
  const permissions = resolveTenantPermissions(
    snapshot.currentUser.permissions,
    role,
  );

  return {
    ...snapshot,
    currentUser: {
      ...snapshot.currentUser,
      organization: activeMembership.organization,
      permissions,
      role,
    },
    organization: activeMembership.organization,
    permissions,
    role,
    rolePermissions: role?.permissions ?? [],
    roles: role ? [role] : [],
  };
}

function resolveTenantPermissions(base: string[], role: Role | null) {
  return [
    ...new Set([
      ...base.filter((permission) => !permission.endsWith(":organization")),
      ...(role?.permissions ?? [])
        .filter((permission) => permission.enabled)
        .map((permission) => permission.permission),
    ]),
  ];
}

function resolvePlatformPermissions(roles: Snapshot["roles"]) {
  return [
    ...new Set(
      roles
        .flatMap((role) => role.permissions ?? [])
        .flat()
        .filter((permission) => permission.enabled)
        .map((permission) => permission.permission),
    ),
  ];
}

function platformUserToDisplayUser(
  platformUser: NonNullable<Snapshot["platformUser"]>,
): Snapshot["user"] {
  return {
    avatarUrl: null,
    createdAt: "",
    displayName: platformUser.displayName,
    email: platformUser.email,
    emailVerified: true,
    firstName: null,
    id: platformUser.id,
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: null,
    preferredLanguage: platformUser.preferredLanguage ?? "zh-CN",
    status: platformUser.status,
    tenantId: null,
    timeZone: null,
    type: "user",
    updatedAt: "",
    username: null,
  };
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
        page.key !== "platform.tenants" &&
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
    hasPageAccess(resolvedSession, "tickets.tenant") ||
    resolvedSession.permissions.includes(
      "ticket.tenant_conversation.list_tenant:own",
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
