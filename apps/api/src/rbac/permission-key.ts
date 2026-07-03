import { getOperationPermissionId } from "@hermes-swarm/access";
import type { PermissionAction, PermissionScope } from "@hermes-swarm/core";

export function buildEntityPermissionKey(
  entity: string,
  action: PermissionAction,
  scope: PermissionScope,
) {
  return getOperationPermissionId(entity, entity, action, scope);
}
