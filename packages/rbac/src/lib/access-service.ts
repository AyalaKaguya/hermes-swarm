import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  PlatformRolePermission,
  PlatformUserRole,
  RolePermission,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { DataSource, In, Repository, type EntityManager } from "typeorm";
import type {
  AccessCheckContext,
  ResolvedAccessDefinition,
} from "./access.types.js";
import { PLATFORM_DATA_SOURCE } from "./tokens.js";

@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(PlatformUserRole, PLATFORM_DATA_SOURCE)
    private readonly platformUserRoleRepository: Repository<PlatformUserRole>,
    @InjectRepository(PlatformRolePermission, PLATFORM_DATA_SOURCE)
    private readonly platformRolePermissionRepository: Repository<PlatformRolePermission>,
    @InjectRepository(UserTenantRole)
    private readonly tenantRoleRepository: Repository<UserTenantRole>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(UserOrganizationRole)
    private readonly organizationRoleRepository: Repository<UserOrganizationRole>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    private readonly dataSource: DataSource,
  ) {}

  async can(
    userId: string,
    definition: ResolvedAccessDefinition,
    context: AccessCheckContext = {},
  ) {
    if (definition.scope === "platform") {
      return context.principalType === "platform"
        ? this.platformRoleAllows(userId, definition.id)
        : false;
    }
    if (context.principalType === "platform") return false;

    const tenantId = context.tenantId ?? undefined;
    if (!tenantId) return false;

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.scope_level', $2, true), set_config('app.organization_id', $3, true)",
        [
          tenantId,
          context.scopeLevel ?? scopeLevelForPermission(definition.scope),
          context.organizationId ?? "",
        ],
      );
      return this.canInTenant(userId, tenantId, definition, context, manager);
    });
  }

  private async canInTenant(
    userId: string,
    tenantId: string,
    definition: ResolvedAccessDefinition,
    context: AccessCheckContext,
    manager: EntityManager,
  ) {

    if (definition.scope === "own") {
      if (context.targetUserId !== userId) return false;
      const tenantRoleIds = await this.findTenantRoleIds(tenantId, userId, manager);
      return this.anyTenantRoleAllows(
        tenantId,
        tenantRoleIds,
        definition.id,
        manager,
      );
    }

    const roleIds = await this.findTenantRoleIds(tenantId, userId, manager);
    if (definition.scope === "tenant") {
      return this.anyTenantRoleAllows(tenantId, roleIds, definition.id, manager);
    }

    const membership = await this.findOrganizationMembership(
      tenantId,
      userId,
      context.organizationId ?? undefined,
      manager,
    );
    if (!membership) return false;
    return this.anyTenantRoleAllows(
      tenantId,
      await this.findOrganizationRoleIds(tenantId, membership, manager),
      definition.id,
      manager,
    );
  }

  private async platformRoleAllows(platformUserId: string, permission: string) {
    const assignments = await this.platformUserRoleRepository.find({
      where: { platformUserId },
    });
    if (assignments.length === 0) return false;
    return Boolean(
      await this.platformRolePermissionRepository.findOne({
        relations: { permission: true },
        where: {
          enabled: true,
          permission: { code: permission },
          platformRoleId: In(assignments.map((item) => item.platformRoleId)),
        },
      }),
    );
  }

  private async findTenantRoleIds(
    tenantId: string,
    userId: string,
    manager: EntityManager,
  ) {
    const assignments = await manager.getRepository(UserTenantRole).find({
      relations: { role: true },
      where: { tenantId, userId },
    });
    return assignments
      .filter((item) => item.role?.scope === "tenant")
      .map((item) => item.roleId);
  }

  private async findOrganizationMembership(
    tenantId: string,
    userId: string,
    organizationId: string | undefined,
    manager: EntityManager,
  ) {
    if (!organizationId) return null;
    return manager.getRepository(UserOrganization).findOne({
      where: { organizationId, status: "active", tenantId, userId },
    });
  }

  private async findOrganizationRoleIds(
    tenantId: string,
    membership: UserOrganization,
    manager: EntityManager,
  ) {
    const assignments = await manager.getRepository(UserOrganizationRole).find({
      relations: { role: true },
      where: { membershipId: membership.id, tenantId },
    });
    return assignments
      .filter(
        (item) =>
          item.role?.scope === "organization" &&
          item.role.organizationId === membership.organizationId,
      )
      .map((item) => item.roleId);
  }

  private async anyTenantRoleAllows(
    tenantId: string,
    roleIds: string[],
    permission: string,
    manager: EntityManager,
  ) {
    const uniqueRoleIds = [...new Set(roleIds)];
    if (uniqueRoleIds.length === 0) return false;
    return Boolean(
      await manager.getRepository(RolePermission).findOne({
        where: {
          enabled: true,
          permission,
          roleId: In(uniqueRoleIds),
          tenantId,
        },
      }),
    );
  }
}

function scopeLevelForPermission(scope: ResolvedAccessDefinition["scope"]) {
  if (scope === "organization") return "organization";
  return "tenant";
}
