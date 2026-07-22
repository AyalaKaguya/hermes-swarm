import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  AccessAuditLog,
  LoginAuditLog,
  Permission,
  Workspace,
  Account,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { In, type Repository, type SelectQueryBuilder } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import type { AuditListQuery } from "./audit-query.js";

type AuditPrincipalScope = "platform" | "workspace";

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly workspaceContext: WorkspaceContextService,
    @InjectRepository(AccessAuditLog)
    private readonly platformAccessAuditRepository: Repository<AccessAuditLog>,
    @InjectRepository(LoginAuditLog)
    private readonly platformLoginAuditRepository: Repository<LoginAuditLog>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(Account)
    private readonly platformAccountRepository: Repository<Account>,
    @InjectRepository(Workspace)
    private readonly workspaceRepository: Repository<Workspace>,
  ) {}

  async listLoginLogs(scope: AuditPrincipalScope, query: AuditListQuery) {
    const workspaceId = this.workspaceIdFor(scope);
    const builder = this.platformLoginAuditRepository
      .createQueryBuilder("log")
      .leftJoin(
        Account,
        "actor",
        actorJoinCondition(scope),
        workspaceId ? { actorWorkspaceId: workspaceId } : undefined,
      )
      .where("log.scope_type = :scope", { scope });
    if (workspaceId) {
      builder.andWhere("log.workspace_id = :workspaceId", { workspaceId });
    }
    applyDateFilters(builder, query);
    if (query.actorId) {
      builder.andWhere("log.actor_id = :actorId", { actorId: query.actorId });
    }
    if (query.result) {
      builder.andWhere("log.result = :result", { result: query.result });
    }
    if (query.keyword) {
      builder.andWhere(
        `(log.attempted_email ILIKE :keyword
          OR COALESCE(actor.display_name, '') ILIKE :keyword
          OR COALESCE(actor.email, '') ILIKE :keyword
          OR COALESCE(log.ip_address, '') ILIKE :keyword
          OR COALESCE(log.device_label, '') ILIKE :keyword
          OR COALESCE(log.failure_code, '') ILIKE :keyword)`,
        { keyword: `%${escapeLike(query.keyword)}%` },
      );
    }
    builder
      .orderBy("log.created_at", "DESC")
      .addOrderBy("log.id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize);
    const [rows, total] = await builder.getManyAndCount();
    const actors = await this.resolveActors(
      scope,
      rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
      workspaceId,
    );
    return {
      items: rows.map((row) => ({
        actor: row.actorId ? actors.get(row.actorId) ?? null : null,
        actorId: row.actorId,
        attemptedEmail: row.attemptedEmail,
        createdAt: row.createdAt,
        deviceLabel: row.deviceLabel,
        failureCode: row.failureCode,
        id: row.id,
        ipAddress: row.ipAddress,
        result: row.result,
        scopeType: row.scopeType,
        sessionId: row.sessionId,
        workspaceId: row.workspaceId,
        userAgent: row.userAgent,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listOperationLogs(scope: AuditPrincipalScope, query: AuditListQuery) {
    const workspaceId = this.workspaceIdFor(scope);
    const builder = this.platformAccessAuditRepository
      .createQueryBuilder("log")
      .leftJoin(
        Account,
        "actor",
        actorJoinCondition(scope),
        workspaceId ? { actorWorkspaceId: workspaceId } : undefined,
      );
    if (scope === "platform") {
      builder.where("log.principal_type = 'platform'");
    } else {
      builder
        .where("log.principal_type IN ('workspace', 'integration')")
        .andWhere("log.scope_type = :scope", { scope })
        .andWhere("log.workspace_id = :workspaceId", { workspaceId });
    }
    applyDateFilters(builder, query);
    if (query.actorId) {
      builder.andWhere("log.actor_id = :actorId", { actorId: query.actorId });
    }
    if (query.result) {
      builder.andWhere("log.result = :result", { result: query.result });
    }
    if (query.permission) {
      builder.andWhere("log.permission = :permission", {
        permission: query.permission,
      });
    }
    if (query.httpMethod) {
      builder.andWhere("log.http_method = :httpMethod", {
        httpMethod: query.httpMethod,
      });
    }
    if (query.keyword) {
      builder.andWhere(
        `(log.permission ILIKE :keyword
          OR COALESCE(actor.display_name, '') ILIKE :keyword
          OR COALESCE(actor.email, '') ILIKE :keyword
          OR COALESCE(log.http_path, '') ILIKE :keyword
          OR COALESCE(log.error_code, '') ILIKE :keyword
          OR COALESCE(log.ip_address, '') ILIKE :keyword)`,
        { keyword: `%${escapeLike(query.keyword)}%` },
      );
    }
    builder
      .orderBy("log.created_at", "DESC")
      .addOrderBy("log.id", "DESC")
      .skip((query.page - 1) * query.pageSize)
      .take(query.pageSize);
    const [rows, total] = await builder.getManyAndCount();
    const [actors, permissions, targetWorkspaces] =
      await Promise.all([
        this.resolveActors(
          scope,
          rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
          workspaceId,
        ),
        this.resolvePermissions(rows.map((row) => row.permission)),
        scope === "platform"
          ? this.resolveTargetWorkspaces(
              rows.flatMap((row) =>
                row.targetWorkspaceId ? [row.targetWorkspaceId] : [],
              ),
            )
          : Promise.resolve(new Map<string, NamedReference>()),
      ]);
    return {
      items: rows.map((row) => {
        const permission = permissions.get(row.permission);
        return {
          actor: row.actorId ? actors.get(row.actorId) ?? null : null,
          actorId: row.actorId,
          createdAt: row.createdAt,
          errorCode: row.errorCode,
          httpMethod: row.httpMethod,
          httpPath: row.httpPath,
          id: row.id,
          ipAddress: row.ipAddress,
          operationLabel: permission?.operationLabel ?? row.permission,
          permission: row.permission,
          principalType: row.principalType,
          result: row.result,
          scopeType: row.scopeType,
          sessionId: row.sessionId,
          statusCode: row.statusCode,
          targetWorkspace:
            row.targetWorkspaceId
              ? targetWorkspaces.get(row.targetWorkspaceId) ?? null
              : null,
          targetWorkspaceId: row.targetWorkspaceId,
          workspaceId: row.workspaceId,
          userAgent: row.userAgent,
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  private async resolveActors(
    scope: AuditPrincipalScope,
    ids: string[],
    workspaceId?: string,
  ) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map<string, ActorReference>();
    const rows =
      scope === "platform"
        ? await this.platformAccountRepository.find({
            withDeleted: true,
            where: { id: In(uniqueIds) },
          })
        : await this.platformAccountRepository
            .createQueryBuilder("account")
            .withDeleted()
            .innerJoin(
              WorkspaceMembership,
              "membership",
              `membership.user_id = account.id
                AND membership.workspace_id = :workspaceId
                AND membership.status = :membershipStatus`,
              {
                membershipStatus: "active",
                workspaceId: workspaceId ?? this.workspaceIdFor("workspace"),
              },
            )
            .where("account.id IN (:...ids)", { ids: uniqueIds })
            .getMany();
    return new Map(
      rows.map((row) => [
        row.id,
        {
          displayName: row.displayName,
          email: row.email,
          id: row.id,
        },
      ]),
    );
  }

  private async resolvePermissions(codes: string[]) {
    const uniqueCodes = [...new Set(codes)];
    if (!uniqueCodes.length) return new Map<string, Permission>();
    const rows = await this.permissionRepository.find({
      where: { code: In(uniqueCodes) },
    });
    return new Map(
      rows.flatMap((row) => (row.code ? [[row.code, row] as const] : [])),
    );
  }

  private async resolveTargetWorkspaces(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map<string, NamedReference>();
    const rows = await this.workspaceRepository.find({
      withDeleted: true,
      where: { id: In(uniqueIds) },
    });
    return new Map(
      rows.map((row) => [row.id, { id: row.id, name: row.name }]),
    );
  }

  private workspaceIdFor(scope: AuditPrincipalScope) {
    return scope === "workspace"
      ? this.workspaceContext.current().workspaceId
      : undefined;
  }
}

function actorJoinCondition(scope: AuditPrincipalScope) {
  if (scope === "platform") return "actor.id = log.actor_id";
  return `actor.id = log.actor_id
    AND EXISTS (
      SELECT 1
      FROM user_workspace_roles actor_membership
      WHERE actor_membership.user_id = log.actor_id
        AND actor_membership.workspace_id = :actorWorkspaceId
        AND actor_membership.status = 'active'
    )`;
}

function applyDateFilters<T extends AccessAuditLog | LoginAuditLog>(
  builder: SelectQueryBuilder<T>,
  query: AuditListQuery,
) {
  if (query.from) {
    builder.andWhere("log.created_at >= :from", { from: query.from });
  }
  if (query.to) {
    builder.andWhere("log.created_at <= :to", { to: query.to });
  }
}

function escapeLike(value: string) {
  return value.replace(/[\\%_]/g, "\\$&");
}

type ActorReference = {
  displayName: string;
  email: string;
  id: string;
};

type NamedReference = {
  id: string;
  name: string;
};
