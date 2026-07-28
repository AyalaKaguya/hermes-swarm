import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Account } from "@hermes-swarm/core";
import {
  AccessCatalogService,
  AccessService,
  type AccessAuthSession,
  type ResolvedAccessDefinition,
} from "@hermes-swarm/rbac";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";
import type { Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { AnalyticsQueryError } from "./analytics-query.error.js";
import type { AnalyticsAuthorizationContext } from "./analytics-source.adapter.js";

export type AnalyticsAuthorizedRequest = Readonly<{
  accessAudit?: {
    definition?: ResolvedAccessDefinition;
    scope?: {
      scopeLevel?: RequestScopeLevel;
      workspaceId?: string | null;
    };
  };
  accessPrincipal?: AccessAuthSession;
  id?: unknown;
}>;

export type AnalyticsAuthorizationRequest = Readonly<{
  operationPermission: string;
  requiredPermissions: readonly string[];
}>;

/**
 * Builds the adapter authorization envelope exclusively from server-owned
 * authentication, RBAC and workspace state. Integration-token capabilities
 * are an additional restriction; they can never grant a missing role right.
 */
@Injectable()
export class AnalyticsAuthorizationContextFactory {
  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    private readonly accessCatalog: AccessCatalogService,
    private readonly accessService: AccessService,
    @InjectRepository(Account)
    private readonly accountRepository: Repository<Account>,
  ) {}

  async create(
    request: AnalyticsAuthorizedRequest,
    input: AnalyticsAuthorizationRequest,
  ): Promise<AnalyticsAuthorizationContext> {
    const principal = request.accessPrincipal;
    const workspace = this.workspaceContext.current(false);
    const auditedDefinition = request.accessAudit?.definition;
    const auditedWorkspaceId = request.accessAudit?.scope?.workspaceId;

    if (
      !principal ||
      principal.principalType === "platform" ||
      !principal.userId?.trim() ||
      !principal.workspaceId?.trim() ||
      !workspace?.workspaceId.trim() ||
      principal.workspaceId !== workspace.workspaceId ||
      (principal.principalType === "integration" &&
        (!principal.integrationToken?.id.trim() ||
          principal.integrationToken.scope !== "workspace" ||
          principal.integrationToken.workspaceId !== workspace.workspaceId)) ||
      auditedWorkspaceId !== workspace.workspaceId ||
      auditedDefinition?.id !== input.operationPermission ||
      auditedDefinition.scope !== "workspace"
    ) {
      throw contextRequired();
    }

    const permissions = new Set<string>();
    for (const permission of new Set(input.requiredPermissions)) {
      const definition = this.accessCatalog.getDefinition(permission);
      if (!definition || definition.scope !== "workspace") continue;
      if (!integrationTokenAllows(principal, permission, workspace.workspaceId)) {
        continue;
      }
      const allowed = await this.accessService.can(
        principal.userId,
        definition,
        {
          principalType: principal.principalType,
          scopeLevel: workspace.scopeLevel,
          workspaceId: workspace.workspaceId,
        },
      );
      if (allowed) permissions.add(permission);
    }

    const account = await this.accountRepository.findOne({
      select: { id: true, preferredLanguage: true, timeZone: true },
      where: { id: principal.userId, status: "active" },
    });
    if (!account) throw contextRequired();

    return Object.freeze({
      actorId: principal.userId,
      integrationTokenId:
        principal.principalType === "integration"
          ? principal.integrationToken?.id ?? null
          : null,
      locale: account.preferredLanguage ?? "zh-Hans",
      permissions,
      principalType: principal.principalType,
      requestId:
        typeof request.id === "string" && request.id.trim()
          ? request.id.trim()
          : randomUUID(),
      timeZone: account.timeZone ?? "UTC",
    });
  }
}

function integrationTokenAllows(
  principal: AccessAuthSession,
  permission: string,
  workspaceId: string,
) {
  if (principal.principalType !== "integration") return true;
  return Boolean(
    principal.integrationToken &&
      principal.integrationToken.scope === "workspace" &&
      principal.integrationToken.workspaceId === workspaceId &&
      principal.integrationToken.permissions.includes(permission),
  );
}
function contextRequired() {
  return new AnalyticsQueryError(
    "ANALYTICS_CONTEXT_REQUIRED",
    "A trusted workspace authorization context is required for analytics.",
  );
}
