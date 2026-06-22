import type { CurrentUser, Snapshot } from "./admin-api";
import { buildMenuPermission } from "./admin-api";

export type UserSession = {
  token: string;
};

export type ResolvedSession = CurrentUser;

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

export function resolveSession(snapshot: Snapshot): ResolvedSession {
  return snapshot.currentUser;
}

export function hasMenuAccess(
  _snapshot: Snapshot,
  resolvedSession: ResolvedSession | null,
  menuCode: string,
  action: "manage" | "view" = "view",
) {
  if (!resolvedSession) {
    return false;
  }

  const expectedPermission = buildMenuPermission(menuCode, action);
  const managePermission = buildMenuPermission(menuCode, "manage");

  return (
    resolvedSession.permissions.includes(expectedPermission) ||
    (action === "view" && resolvedSession.permissions.includes(managePermission))
  );
}

export function hasAnyManagementAccess(
  snapshot: Snapshot,
  resolvedSession: ResolvedSession | null,
) {
  return (
    hasMenuAccess(snapshot, resolvedSession, "organizations") ||
    hasMenuAccess(snapshot, resolvedSession, "users") ||
    hasMenuAccess(snapshot, resolvedSession, "roles") ||
    hasMenuAccess(snapshot, resolvedSession, "permissions") ||
    hasMenuAccess(snapshot, resolvedSession, "settings")
  );
}
