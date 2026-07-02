import {
  getPageAccessDefinition,
  type AccessMode,
} from "@hermes-swarm/access";
import type { ResolvedSession } from "./session";

type AccessPrincipal = ResolvedSession;

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

export function hasPageAccess(
  principal: AccessPrincipal | null | undefined,
  pageKey: string,
  _routeContext: { organizationId?: string | null } = {},
) {
  const definition = getPageAccessDefinition(pageKey);
  if (!definition) return false;
  return hasPermission(principal, definition.permission);
}
