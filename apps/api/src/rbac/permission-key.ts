import type {
  PermissionAction,
  PermissionScope,
} from "@hermes-swarm/core";

export function buildEntityPermissionKey(
  entity: string,
  action: PermissionAction,
  scope: PermissionScope,
) {
  return `${entity}:${action}:${scope}`;
}
