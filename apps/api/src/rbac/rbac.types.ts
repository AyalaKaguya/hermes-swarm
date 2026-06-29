import type {
  PermissionAction,
  PermissionScope,
} from "@hermes-swarm/core";

export type PermissionRequirement = {
  action: PermissionAction;
  entity: string;
  scope: PermissionScope;
};
