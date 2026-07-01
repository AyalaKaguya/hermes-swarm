import {
  getPageAccessDefinition,
  type AccessMode,
} from "@hermes-swarm/access";
import type { ResolvedSession } from "./session";

type AccessRole = {
  name?: string | null;
  scope?: "organization" | "platform" | string | null;
};

type AccessMembership = {
  organizationId?: string | null;
  role?: AccessRole | null;
  roleId?: string | null;
  status?: string | null;
};

type AccessPrincipal = ResolvedSession & {
  memberships?: AccessMembership[] | null;
  platformMembership?: {
    role?: AccessRole | null;
    roleId?: string | null;
    status?: string | null;
  } | null;
  role?: AccessRole | null;
};

export function hasPermission(
  principal: AccessPrincipal | null | undefined,
  permissions: string | string[],
  options: { mode?: AccessMode } = {},
) {
  if (!principal) return false;
  const required = Array.isArray(permissions) ? permissions : [permissions];
  if (required.length === 0) return true;
  const owned = new Set(principal.permissions ?? []);
  return (options.mode ?? "any") === "all"
    ? required.every((permission) => owned.has(permission))
    : required.some((permission) => owned.has(permission));
}

export function hasRole(
  principal: AccessPrincipal | null | undefined,
  roles: string | string[],
  options: {
    mode?: AccessMode;
    organizationId?: string | null;
    scope?: "organization" | "platform";
  } = {},
) {
  if (!principal) return false;
  const required = Array.isArray(roles) ? roles : [roles];
  if (required.length === 0) return true;
  const owned = collectRoleNames(principal, options);
  return (options.mode ?? "any") === "all"
    ? required.every((role) => owned.has(role))
    : required.some((role) => owned.has(role));
}

export function hasPageAccess(
  principal: AccessPrincipal | null | undefined,
  pageKey: string,
  _routeContext: { organizationId?: string | null } = {},
) {
  const definition = getPageAccessDefinition(pageKey);
  if (!definition) return false;
  return hasPermission(principal, definition.permission);
}

function collectRoleNames(
  principal: AccessPrincipal,
  options: {
    organizationId?: string | null;
    scope?: "organization" | "platform";
  },
) {
  const names = new Set<string>();
  if (options.scope !== "organization") {
    const platformRole = principal.platformMembership?.role?.name;
    if (platformRole) names.add(platformRole);
  }
  if (options.scope !== "platform") {
    const activeOrganizationId =
      options.organizationId ?? principal.organization?.id ?? null;
    for (const membership of principal.memberships ?? []) {
      if (membership.status === "disabled") continue;
      if (
        activeOrganizationId &&
        membership.organizationId &&
        membership.organizationId !== activeOrganizationId
      ) {
        continue;
      }
      const roleName = membership.role?.name;
      if (roleName) names.add(roleName);
    }
    const roleName = principal.role?.name;
    if (roleName) names.add(roleName);
  }
  return names;
}
