import type { Type } from "@nestjs/common";
import type {
  PermissionCatalogSource,
  PermissionScope,
} from "@hermes-swarm/core";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";

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
  scopeLevel?: RequestScopeLevel;
  tenantId?: string | null;
  targetUserId?: string | null;
};

export type AccessRequest = {
  accessAudit?: {
    definition: ResolvedAccessDefinition;
    scope: AccessScopeResult;
  };
  accessPrincipal?: AccessAuthSession;
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
  method?: string;
  originalUrl?: string;
  url?: string;
  [key: string]: unknown;
};

export type AccessScopeContext = {
  definition: ResolvedAccessDefinition;
  request: AccessRequest;
};

export type AccessScopeResolver = {
  resolve(context: AccessScopeContext): Promise<AccessScopeResult> | AccessScopeResult;
};

export type AccessScopeMetadata = {
  param?: string;
  resolver?: Type<AccessScopeResolver>;
  scope?: PermissionScope | RequestScopeLevel;
};

export type AccessAuthSession = {
  integrationToken?: {
    id: string;
    permissions: string[];
    scope: "tenant";
    tenantId: string;
  } | null;
  principalType: "integration" | "platform" | "tenant";
  sessionId?: string;
  tenantId: string | null;
  tokenKind?: "integration" | "session";
  userId: string;
};

export type AccessAuthSessionService = {
  validateAccessToken(token: string | undefined): Promise<AccessAuthSession>;
};

export type AccessCheckContext = {
  organizationId?: string | null;
  principalType?: "integration" | "platform" | "tenant";
  scopeLevel?: RequestScopeLevel;
  tenantId?: string | null;
  targetUserId?: string | null;
};

export type PermissionResourceMetadata = AccessResourceMetadata;
export type PermissionOperationMetadata = AccessOperationMetadata;
export type PermissionRequirement = AccessRequirement;
export type PermissionDefaultRole = AccessDefaultRole;
export type ResolvedPermissionDefinition = ResolvedAccessDefinition;
