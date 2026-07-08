import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  PlatformMember,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import type {
  AccessCheckContext,
  ResolvedAccessDefinition,
} from "./access.types.js";

@Injectable()
export class AccessService {
  constructor(
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
  ) {}

  async can(
    userId: string,
    definition: ResolvedAccessDefinition,
    context: AccessCheckContext = {},
  ) {
    if (definition.scope === "own") {
      if (!this.userOwnsTarget(userId, context.targetUserId ?? undefined)) {
        return false;
      }
      const roleIds = await this.findOwnScopeRoleIds(userId);
      return this.anyRoleAllows(roleIds, definition.id);
    }

    if (definition.scope === "platform") {
      const roleId = await this.findPlatformRoleId(userId);
      return roleId ? this.roleAllows(roleId, definition.id) : false;
    }

    const organizationRoleId = await this.findOrganizationRoleId(
      userId,
      context.organizationId ?? undefined,
    );
    if (
      organizationRoleId &&
      (await this.roleAllows(organizationRoleId, definition.id))
    ) {
      return true;
    }

    const platformRoleId = await this.findPlatformRoleId(userId);
    return platformRoleId
      ? this.roleAllows(platformRoleId, definition.id)
      : false;
  }

  private async roleAllows(roleId: string, permissionId: string) {
    return Boolean(
      await this.rolePermissionRepository.findOne({
        where: {
          enabled: true,
          permission: permissionId,
          roleId,
        },
      }),
    );
  }

  private async anyRoleAllows(roleIds: string[], permissionId: string) {
    for (const roleId of roleIds) {
      if (await this.roleAllows(roleId, permissionId)) return true;
    }
    return false;
  }

  private async findPlatformRoleId(userId: string) {
    const member = await this.platformMemberRepository.findOne({
      where: { status: "active", userId },
    });
    return member?.roleId ?? null;
  }

  private async findOwnScopeRoleIds(userId: string) {
    const roleIds = new Set<string>();
    const platformRoleId = await this.findPlatformRoleId(userId);
    if (platformRoleId) roleIds.add(platformRoleId);

    const memberships = await this.membershipRepository.find({
      where: { status: "active", userId },
    });
    for (const membership of memberships) {
      if (membership.roleId) roleIds.add(membership.roleId);
    }

    return [...roleIds];
  }

  private async findOrganizationRoleId(
    userId: string,
    organizationId: string | undefined,
  ) {
    if (!organizationId) return null;
    const membership = await this.membershipRepository.findOne({
      where: { organizationId, status: "active", userId },
    });
    return membership?.roleId ?? null;
  }

  private userOwnsTarget(userId: string, targetUserId: string | undefined) {
    return Boolean(targetUserId && targetUserId === userId);
  }
}
