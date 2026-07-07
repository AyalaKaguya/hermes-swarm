import type { Type } from "@nestjs/common";
import type {
  PermissionCatalogSource,
  PermissionScope,
} from "@hermes-swarm/core";

export type AccessDefaultRole = string;

export type AccessResourceMetadata = {
  entity: string;
  entityLabel: string;
  entityOrder?: number | null;
  purpose: string;
  purposeLabel: string;
  purposeOrder?: number | null;
  scope: PermissionScope;
};

export type AccessOperationMetadata = Partial<AccessResourceMetadata> & {
  defaultRoles?: AccessDefaultRole[];
  description?: string | null;
  isDangerous?: boolean;
  label: string;
  operation: string;
  sortOrder?: number | null;
};

export type AccessRequirement = AccessOperationMetadata;

export type ResolvedAccessDefinition = AccessResourceMetadata & {
  defaultRoles: AccessDefaultRole[];
  description: string | null;
  id: string;
  isDangerous: boolean;
  operation: string;
  operationLabel: string;
  operationOrder: number | null;
  source?: PermissionCatalogSource;
};

export type AccessScopeResult = {
  organizationId?: string | null;
  targetUserId?: string | null;
};

export type AccessScopeContext = {
  definition: ResolvedAccessDefinition;
  request: {
    params?: Record<string, string | undefined>;
    [key: string]: unknown;
  };
};

export type AccessScopeResolver = {
  resolve(context: AccessScopeContext): Promise<AccessScopeResult> | AccessScopeResult;
};

export type AccessScopeMetadata = {
  param?: string;
  resolver?: Type<AccessScopeResolver>;
  scope?: PermissionScope;
};

export type AccessAuthSession = {
  integrationToken?: {
    id: string;
    organizationId: string | null;
    permissions: string[];
    scope: PermissionScope;
  } | null;
  sessionId?: string;
  tokenKind?: "integration" | "session";
  userId: string;
};

export type AccessAuthSessionService = {
  validateAccessToken(token: string | undefined): Promise<AccessAuthSession>;
};

export type AccessCheckContext = {
  organizationId?: string | null;
  targetUserId?: string | null;
};

export type PermissionResourceMetadata = AccessResourceMetadata;
export type PermissionOperationMetadata = AccessOperationMetadata;
export type PermissionRequirement = AccessRequirement;
export type PermissionDefaultRole = AccessDefaultRole;
export type ResolvedPermissionDefinition = ResolvedAccessDefinition;
