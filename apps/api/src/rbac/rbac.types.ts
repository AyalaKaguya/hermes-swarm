import type { PermissionScope } from "@hermes-swarm/core";

export type PermissionDefaultRole =
  | "admin"
  | "member"
  | "owner"
  | "platform-admin"
  | "viewer";

export type PermissionResourceMetadata = {
  entity: string;
  entityLabel: string;
  entityOrder?: number | null;
  purpose: string;
  purposeLabel: string;
  purposeOrder?: number | null;
  scope: PermissionScope;
};

export type PermissionOperationMetadata = Partial<PermissionResourceMetadata> & {
  defaultRoles?: PermissionDefaultRole[];
  description?: string | null;
  isDangerous?: boolean;
  label: string;
  operation: string;
  sortOrder?: number | null;
};

export type PermissionRequirement = PermissionOperationMetadata;

export type ResolvedPermissionDefinition = PermissionResourceMetadata & {
  defaultRoles: PermissionDefaultRole[];
  description: string | null;
  id: string;
  isDangerous: boolean;
  operation: string;
  operationLabel: string;
  operationOrder: number | null;
};
