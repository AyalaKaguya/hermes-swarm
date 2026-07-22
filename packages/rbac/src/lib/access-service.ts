import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  PlatformMembership,
  RolePermission,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { In, Repository } from "typeorm";
import type {
  AccessCheckContext,
  ResolvedAccessDefinition,
} from "./access.types.js";

@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(PlatformMembership)
    private readonly platformMembershipRepository: Repository<PlatformMembership>,
    @InjectRepository(RolePermission)
    private readonly platformRolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(WorkspaceMembership)
    private readonly workspaceRoleRepository: Repository<WorkspaceMembership>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
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

    return this.canInWorkspace(userId, workspaceId, definition, context);
  }

  private async canInWorkspace(
    userId: string,
    workspaceId: string,
    definition: ResolvedAccessDefinition,
    context: AccessCheckContext,
  ) {

    if (definition.scope === "own") {
      if (context.targetUserId !== userId) return false;
      const workspaceRoleIds = await this.findWorkspaceRoleIds(workspaceId, userId);
      return this.anyWorkspaceRoleAllows(
        workspaceId,
        workspaceRoleIds,
        definition.id,
      );
    }

    const roleIds = await this.findWorkspaceRoleIds(workspaceId, userId);
    if (definition.scope === "workspace") {
      return this.anyWorkspaceRoleAllows(workspaceId, roleIds, definition.id);
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
  ) {
    const assignments = await this.workspaceRoleRepository.find({
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
  ) {
    const uniqueRoleIds = [...new Set(roleIds)];
    if (uniqueRoleIds.length === 0) return false;
    return Boolean(
      await this.rolePermissionRepository.findOne({
        relations: { permissionRecord: true, role: true },
        where: {
          enabled: true,
          permissionRecord: { code: permission },
          roleId: In(uniqueRoleIds),
          role: { scope: "workspace", workspaceId },
        },
      }),
    );
  }
}
