import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  AccessAuditLog,
  LoginAuditLog,
  Organization,
  Permission,
  PlatformUser,
  Tenant,
  User,
} from "@hermes-swarm/core";
import { In, type Repository, type SelectQueryBuilder } from "typeorm";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import type { AuditListQuery } from "./audit-query.js";

type AuditPrincipalScope = "platform" | "tenant";

@Injectable()
export class AuditQueryService {
  constructor(
    private readonly tenantContext: TenantContextService,
    @InjectRepository(AccessAuditLog, PLATFORM_DATA_SOURCE)
    private readonly platformAccessAuditRepository: Repository<AccessAuditLog>,
    @InjectRepository(LoginAuditLog, PLATFORM_DATA_SOURCE)
    private readonly platformLoginAuditRepository: Repository<LoginAuditLog>,
    @InjectRepository(Permission, PLATFORM_DATA_SOURCE)
    private readonly permissionRepository: Repository<Permission>,
    @InjectRepository(PlatformUser, PLATFORM_DATA_SOURCE)
    private readonly platformUserRepository: Repository<PlatformUser>,
    @InjectRepository(Tenant, PLATFORM_DATA_SOURCE)
    private readonly tenantRepository: Repository<Tenant>,
  ) {}

  async listLoginLogs(scope: AuditPrincipalScope, query: AuditListQuery) {
    const repository =
      scope === "platform"
        ? this.platformLoginAuditRepository
        : this.tenantContext.repository(LoginAuditLog);
    const builder = repository
      .createQueryBuilder("log")
      .leftJoin(
        scope === "platform" ? PlatformUser : User,
        "actor",
        "actor.id = log.actor_id",
      )
      .where("log.scope_type = :scope", { scope });
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
        tenantId: row.tenantId,
        userAgent: row.userAgent,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listOperationLogs(scope: AuditPrincipalScope, query: AuditListQuery) {
    const repository =
      scope === "platform"
        ? this.platformAccessAuditRepository
        : this.tenantContext.repository(AccessAuditLog);
    const builder = repository
      .createQueryBuilder("log")
      .leftJoin(
        scope === "platform" ? PlatformUser : User,
        "actor",
        "actor.id = log.actor_id",
      );
    if (scope === "platform") {
      builder.where("log.principal_type = 'platform'");
    } else {
      builder.where("log.principal_type IN ('tenant', 'integration')");
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
    const [actors, permissions, organizations, targetTenants] =
      await Promise.all([
        this.resolveActors(
          scope,
          rows.flatMap((row) => (row.actorId ? [row.actorId] : [])),
        ),
        this.resolvePermissions(rows.map((row) => row.permission)),
        scope === "tenant"
          ? this.resolveOrganizations(
              rows.flatMap((row) =>
                row.organizationId ? [row.organizationId] : [],
              ),
            )
          : Promise.resolve(new Map<string, NamedReference>()),
        scope === "platform"
          ? this.resolveTargetTenants(
              rows.flatMap((row) =>
                row.targetTenantId ? [row.targetTenantId] : [],
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
          organization:
            row.organizationId
              ? organizations.get(row.organizationId) ?? null
              : null,
          organizationId: row.organizationId,
          permission: row.permission,
          principalType: row.principalType,
          result: row.result,
          scopeType: row.scopeType,
          sessionId: row.sessionId,
          statusCode: row.statusCode,
          targetTenant:
            row.targetTenantId
              ? targetTenants.get(row.targetTenantId) ?? null
              : null,
          targetTenantId: row.targetTenantId,
          tenantId: row.tenantId,
          userAgent: row.userAgent,
        };
      }),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  private async resolveActors(scope: AuditPrincipalScope, ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map<string, ActorReference>();
    const repository =
      scope === "platform"
        ? this.platformUserRepository
        : this.tenantContext.repository(User);
    const rows = await repository.find({
      withDeleted: true,
      where: { id: In(uniqueIds) },
    });
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

  private async resolveOrganizations(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map<string, NamedReference>();
    const rows = await this.tenantContext.repository(Organization).find({
      withDeleted: true,
      where: { id: In(uniqueIds) },
    });
    return new Map(
      rows.map((row) => [row.id, { id: row.id, name: row.name }]),
    );
  }

  private async resolveTargetTenants(ids: string[]) {
    const uniqueIds = [...new Set(ids)];
    if (!uniqueIds.length) return new Map<string, NamedReference>();
    const rows = await this.tenantRepository.find({
      withDeleted: true,
      where: { id: In(uniqueIds) },
    });
    return new Map(
      rows.map((row) => [row.id, { id: row.id, name: row.name }]),
    );
  }
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
