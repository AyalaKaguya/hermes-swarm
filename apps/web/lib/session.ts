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
  { manage: string[]; view: string[] }
> = {
  account: {
    manage: ["user.self_profile.update_profile:own"],
    view: ["user.self_profile.update_profile:own"],
  },
  "custom-smtp": {
    manage: ["mail.smtp.save:organization"],
    view: ["mail.smtp.view:organization"],
  },
  "email-templates": {
    manage: [
      "mail.template.create:organization",
      "mail.template.update:organization",
      "mail.template.delete:organization",
    ],
    view: ["mail.template.list:organization"],
  },
  features: {
    manage: ["setting.organization_config.save:organization"],
    view: ["setting.organization_config.list:organization"],
  },
  groups: {
    manage: [
      "group.organization_group.create:organization",
      "group.organization_group.update_basic:organization",
      "group.organization_group.delete:organization",
      "group.organization_group.replace_members:organization",
    ],
    view: ["group.organization_group.list:organization"],
  },
  "notification-destinations": {
    manage: [
      "notification.destination.create:organization",
      "notification.destination.update:organization",
      "notification.destination.delete:organization",
    ],
    view: ["notification.destination.list:organization"],
  },
  organization: {
    manage: ["organization.profile.update_basic:organization"],
    view: ["organization.profile.view:organization"],
  },
  organizations: {
    manage: [
      "organization.platform_organization.create:platform",
      "organization.platform_organization.delete:platform",
    ],
    view: ["organization.platform_organization.list:platform"],
  },
  platform: {
    manage: ["setting.platform_config.save:platform"],
    view: ["setting.platform_config.list:platform"],
  },
  roles: {
    manage: [
      "role.organization_role.create:organization",
      "role.organization_role.update_basic:organization",
      "role.organization_role.replace_permissions:organization",
      "role.organization_role.delete:organization",
    ],
    view: ["role.organization_role.list:organization"],
  },
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

  const accepted =
    action === "view"
      ? [...mapped.view, ...mapped.manage]
      : mapped.manage;
  return accepted.some((permission) =>
    resolvedSession.permissions.includes(permission),
  );
}

export function hasAnyManagementAccess(
  snapshot: Pick<Snapshot, "isPlatformAdmin">,
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
