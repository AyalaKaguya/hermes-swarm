import type { CurrentUser, Snapshot } from "./admin-api";

export type UserSession = {
  expiresAt: string;
  sessionId: string;
};

export type ResolvedSession = CurrentUser;

const SESSION_KEY = "hermes-swarm.admin-session";

export function getStoredSession(): UserSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  // Remove legacy browser-readable access tokens. Web auth now lives in an
  // httpOnly BFF session cookie.
  const rawValue = window.localStorage.getItem(SESSION_KEY);
  if (!rawValue) {
    return null;
  }

  try {
    const value = JSON.parse(rawValue) as Partial<UserSession>;
    if ("accessToken" in value) {
      window.localStorage.removeItem(SESSION_KEY);
      return null;
    }
    if (!value.expiresAt || !value.sessionId) {
      return null;
    }
    return {
      expiresAt: value.expiresAt,
      sessionId: value.sessionId,
    };
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

export function hasAnyManagementAccess(
  _snapshot: Pick<Snapshot, "isPlatformAdmin">,
  resolvedSession: ResolvedSession | null,
) {
  return Boolean(
    resolvedSession &&
      (resolvedSession.permissions?.length ||
        resolvedSession.memberships?.some(
          (membership) => membership.role?.permissions?.some((item) => item.enabled),
        ) ||
        resolvedSession.platformUser?.roles.some((role) =>
          role.permissions?.some((item) => item.enabled),
        )),
  );
}
