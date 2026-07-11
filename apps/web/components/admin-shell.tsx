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
import { ScopeProvider, useRequestScope } from "@/components/scope-provider";
import { PAGE_ACCESS_DEFINITIONS } from "@hermes-swarm/rbac-api";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import {
  fetchMe,
  isUnauthorizedApiError,
  type Snapshot,
} from "@/lib/admin-api";
import { clearStoredSession, resolveSession, type ResolvedSession } from "@/lib/session";
import { hasPageAccess } from "@/lib/access-control";
import { resolveHostOrganizationIdFromPrincipal } from "@/lib/host-organization";
import { resolvePlatformNameFromSettings } from "@/lib/platform-settings";
import { resolvePrincipalRoute } from "@/lib/principal-route";
import {
  commitRequestScope,
  getActiveRequestScope,
  resolveInitialRequestScope,
  storeRequestScope,
} from "@/lib/request-scope";

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
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [resolvedSession, setResolvedSession] =
    useState<ResolvedSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [redirectingToLogin, setRedirectingToLogin] = useState(false);

  useEffect(() => {
    loadingSessionFailedMessageRef.current = t("shell.loadingSessionFailed");
  }, [t]);

  const loadSnapshot = useCallback(
    async (options: { showLoading?: boolean } = {}) => {
      if (options.showLoading ?? true) {
        setRedirectingToLogin(false);
        setLoading(true);
      }
      try {
        const principal = await fetchMe();
        const redirectPath = resolvePrincipalRoute(
          principal.principalType,
          pathname,
        );
        if (redirectPath) {
          router.replace(redirectPath);
          return;
        }
        const initialScope =
          principal.principalType === "tenant"
            ? resolveInitialRequestScope(principal)
            : null;
        commitRequestScope(initialScope);
        const data = createShellSnapshot(
          principal,
          initialScope?.organizationId ?? undefined,
        );
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
    [pathname, router],
  );

  useEffect(() => {
    void loadSnapshot({ showLoading: true });
  }, [loadSnapshot]);

  async function switchOrganization(organizationId: string) {
    const currentSnapshot = snapshot;
    if (!currentSnapshot || currentSnapshot.principalType !== "tenant") {
      return;
    }
    const tenantId =
      currentSnapshot.tenantId ?? currentSnapshot.user.tenantId ?? null;
    const nextScope = commitRequestScope({
      departmentId: null,
      level: "organization",
      organizationId,
      tenantId,
    });
    if (nextScope) {
      storeRequestScope(window.localStorage, currentSnapshot.user.id, nextScope);
    }
    const result = selectSnapshotOrganization(currentSnapshot, organizationId);
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
    <ScopeProvider principal={snapshot}>
      <AppShell
      contentClassName={pathname.startsWith("/settings") ? "p-0" : undefined}
      currentOrganizationId={snapshot.organization?.id}
      departmentMemberships={snapshot.departmentMemberships}
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
      tenant={snapshot.tenant}
      user={resolvedSession.user}
      >
        <AdminShellContext.Provider value={contextValue}>
          <ScopeEpochBoundary>{children}</ScopeEpochBoundary>
        </AdminShellContext.Provider>
      </AppShell>
    </ScopeProvider>
  );
}

function ScopeEpochBoundary({ children }: { children: ReactNode }) {
  const { scope } = useRequestScope();
  return (
    <div
      className="contents"
      key={`${scope?.scopeKey ?? "platform"}:${scope?.epoch ?? 0}`}
    >
      {children}
    </div>
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
      departmentMemberships: [],
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
      scope: { departmentId: null, level: "platform", organizationId: null },
      settings: [],
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
  const role = activeMembership?.role ?? principal.tenantRoles?.[0] ?? null;
  const activePermissions = principal.permissions;
  const isPlatformAdmin = false;
  const activeScope = getActiveRequestScope();

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
    scope: {
      departmentId: activeScope?.departmentId ?? null,
      level: activeScope?.level ?? (organization ? "organization" : "platform"),
      organizationId:
        activeScope?.organizationId ?? organization?.id ?? null,
    },
    settings: [],
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
  organizationId: string,
): Snapshot {
  const activeMembership =
    snapshot.memberships.find(
      (membership) =>
        membership.organizationId === organizationId &&
        membership.status === "active",
    ) ?? null;
  if (!activeMembership?.organization) return snapshot;
  const role = activeMembership.role ?? snapshot.tenantRoles?.[0] ?? null;

  return {
    ...snapshot,
    currentUser: {
      ...snapshot.currentUser,
      organization: activeMembership.organization,
      role,
    },
    organization: activeMembership.organization,
    role,
    rolePermissions: role?.permissions ?? [],
    roles: role ? [role] : [],
  };
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
