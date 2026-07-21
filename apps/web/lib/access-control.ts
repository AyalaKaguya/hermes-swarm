import {
  getPageAccessDefinition,
  type AccessMode,
} from "@hermes-swarm/rbac-api";
import type { RolePermission } from "./admin-api";
import type { ResolvedSession } from "./session";

type AccessPrincipal = ResolvedSession;

export function mergePermissionCodes(
  base: readonly string[],
  ...roles: Array<{ permissions?: RolePermission[] } | null | undefined>
) {
  return [
    ...new Set([
      ...base,
      ...roles.flatMap((role) =>
        (role?.permissions ?? [])
          .filter((permission) => permission.enabled !== false)
          .map((permission) => permission.permission),
      ),
    ]),
  ];
}

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
) {
  const definition = getPageAccessDefinition(pageKey);
  if (!definition) return false;
  if (!principal) return false;

  if (definition.scope === "platform") {
    if (principal.principalType !== "platform") return false;
    return hasPermission(principal, definition.permission);
  }

  if (principal.principalType !== "workspace") return false;
  return hasPermission(principal, definition.permission);
}
