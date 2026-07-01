import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  PlatformMember,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import type { ResolvedPermissionDefinition } from "./rbac.types.js";

@Injectable()
export class RbacService {
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
    definition: ResolvedPermissionDefinition,
    organizationId?: string,
  ) {
    if (definition.scope === "own") {
      return this.userOwnsTarget(userId, organizationId);
    }

    if (definition.scope === "platform") {
      const roleId = await this.findPlatformRoleId(userId);
      return roleId ? this.roleAllows(roleId, definition.id) : false;
    }

    const organizationRoleId = await this.findOrganizationRoleId(
      userId,
      organizationId,
    );
    if (
      organizationRoleId &&
      (await this.roleAllows(organizationRoleId, definition.id))
    ) {
      return true;
    }

    const platformRoleId = await this.findPlatformRoleId(userId);
    return platformRoleId ? this.roleAllows(platformRoleId, definition.id) : false;
  }

  private async roleAllows(
    roleId: string,
    permissionId: string,
  ) {
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

  private async findPlatformRoleId(userId: string) {
    const member = await this.platformMemberRepository.findOne({
      where: { status: "active", userId },
    });
    return member?.roleId ?? null;
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
