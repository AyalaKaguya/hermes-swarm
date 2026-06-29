import type { CurrentUser, PrincipalSession, Snapshot } from "./admin-api";

export type UserSession = {
  token: string;
};

export type ResolvedSession = CurrentUser | PrincipalSession;

const SESSION_KEY = "hermes-swarm.admin-session";

export function getStoredSession(): UserSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(SESSION_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const value = JSON.parse(rawValue) as Partial<UserSession>;
    if (!value.token) {
      return null;
    }
    return { token: value.token };
  } catch {
    return null;
  }
}

export function storeSession(session: UserSession) {
  window.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  window.localStorage.removeItem(SESSION_KEY);
}

export function resolveSession(snapshot: Snapshot | PrincipalSession): ResolvedSession {
  if ("currentUser" in snapshot) {
    return snapshot.currentUser;
  }

  const activeMembership = snapshot.memberships[0] ?? null;
  return {
    ...snapshot,
    organization: snapshot.organization ?? activeMembership?.organization ?? null,
    role: snapshot.role ?? snapshot.platformMembership?.role ?? activeMembership?.role ?? null,
  };
}

const MENU_PERMISSION_MAP: Record<
  string,
  { entity: string; scope: "organization" | "own" | "platform" }
> = {
  account: { entity: "user", scope: "own" },
  "custom-smtp": { entity: "mail", scope: "organization" },
  "email-templates": { entity: "mail", scope: "organization" },
  features: { entity: "setting", scope: "organization" },
  "notification-destinations": {
    entity: "notification",
    scope: "organization",
  },
  organization: { entity: "organization", scope: "organization" },
  organizations: { entity: "organization", scope: "platform" },
  roles: { entity: "role", scope: "organization" },
  tenant: { entity: "setting", scope: "platform" },
};

export function hasMenuAccess(
  snapshot: Pick<Snapshot, "isPlatformAdmin">,
  resolvedSession: ResolvedSession | null,
  menuCode: string,
  action: "manage" | "view" = "view",
) {
  if (!resolvedSession) {
    return false;
  }
  if (snapshot.isPlatformAdmin || resolvedSession.isPlatformAdmin) {
    return true;
  }

  const mapped = MENU_PERMISSION_MAP[menuCode];
  if (!mapped) return false;

  const permissionAction = action === "view" ? "read" : "update";
  const expectedPermission = `${mapped.entity}:${permissionAction}:${mapped.scope}`;
  const createPermission = `${mapped.entity}:create:${mapped.scope}`;
  const deletePermission = `${mapped.entity}:delete:${mapped.scope}`;
  return action === "view"
    ? resolvedSession.permissions.includes(expectedPermission) ||
        resolvedSession.permissions.includes(createPermission) ||
        resolvedSession.permissions.includes(deletePermission)
    : resolvedSession.permissions.includes(expectedPermission) ||
        resolvedSession.permissions.includes(createPermission) ||
        resolvedSession.permissions.includes(deletePermission);
}

export function hasAnyManagementAccess(
  snapshot: Pick<Snapshot, "isPlatformAdmin" | "menus">,
  resolvedSession: ResolvedSession | null,
) {
  return Boolean(
    resolvedSession &&
      (snapshot.isPlatformAdmin ||
        resolvedSession.isPlatformAdmin ||
        resolvedSession.memberships?.length ||
        resolvedSession.platformMembership),
  );
}
