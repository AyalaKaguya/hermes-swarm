import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  PlatformMembership,
  RolePermission,
  WorkspaceMembership,
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
    @InjectRepository(PlatformMembership, PLATFORM_DATA_SOURCE)
    private readonly platformMembershipRepository: Repository<PlatformMembership>,
    @InjectRepository(RolePermission, PLATFORM_DATA_SOURCE)
    private readonly platformRolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(WorkspaceMembership)
    private readonly workspaceRoleRepository: Repository<WorkspaceMembership>,
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

    const workspaceId = context.workspaceId ?? undefined;
    if (!workspaceId) return false;

    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('app.workspace_id', $1, true), set_config('app.scope_level', $2, true)",
        [
          workspaceId,
          context.scopeLevel ?? scopeLevelForPermission(definition.scope),
        ],
      );
      return this.canInWorkspace(userId, workspaceId, definition, context, manager);
    });
  }

  private async canInWorkspace(
    userId: string,
    workspaceId: string,
    definition: ResolvedAccessDefinition,
    context: AccessCheckContext,
    manager: EntityManager,
  ) {

    if (definition.scope === "own") {
      if (context.targetUserId !== userId) return false;
      const workspaceRoleIds = await this.findWorkspaceRoleIds(workspaceId, userId, manager);
      return this.anyWorkspaceRoleAllows(
        workspaceId,
        workspaceRoleIds,
        definition.id,
        manager,
      );
    }

    const roleIds = await this.findWorkspaceRoleIds(workspaceId, userId, manager);
    if (definition.scope === "workspace") {
      return this.anyWorkspaceRoleAllows(workspaceId, roleIds, definition.id, manager);
    }

    return false;
  }

  private async platformRoleAllows(accountId: string, permission: string) {
    const membership = await this.platformMembershipRepository.findOne({
      relations: { role: true },
      where: { accountId, status: "active" },
    });
    if (!membership?.roleId || membership.role?.scope !== "platform") return false;
    return Boolean(
      await this.platformRolePermissionRepository.findOne({
        relations: { permissionRecord: true },
        where: {
          enabled: true,
          permissionRecord: { code: permission },
          roleId: membership.roleId,
        },
      }),
    );
  }

  private async findWorkspaceRoleIds(
    workspaceId: string,
    userId: string,
    manager: EntityManager,
  ) {
    const assignments = await manager.getRepository(WorkspaceMembership).find({
      relations: { role: true },
      where: { accountId: userId, status: "active", workspaceId },
    });
    return assignments
      .filter(
        (item): item is WorkspaceMembership & { roleId: string } =>
          item.role?.scope === "workspace" && Boolean(item.roleId),
      )
      .map((item) => item.roleId);
  }

  private async anyWorkspaceRoleAllows(
    workspaceId: string,
    roleIds: string[],
    permission: string,
    manager: EntityManager,
  ) {
    const uniqueRoleIds = [...new Set(roleIds)];
    if (uniqueRoleIds.length === 0) return false;
    return Boolean(
      await manager.getRepository(RolePermission).findOne({
        relations: { permissionRecord: true },
        where: {
          enabled: true,
          permissionRecord: { code: permission },
          roleId: In(uniqueRoleIds),
        },
      }),
    );
  }
}

function scopeLevelForPermission(scope: ResolvedAccessDefinition["scope"]) {
  return "workspace";
}
