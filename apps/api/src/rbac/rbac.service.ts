import { Injectable, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  DEFAULT_PERMISSION_KEYS,
  Permission,
  type PermissionAction,
  type PermissionScope,
  PlatformMember,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import { buildEntityPermissionKey } from "./permission-key.js";
import type { PermissionRequirement } from "./rbac.types.js";

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  async onModuleInit() {
    await this.ensurePermissionCatalog(
      DEFAULT_PERMISSION_KEYS.map(parsePermissionKey),
    );
  }

  async can(
    userId: string,
    requirement: PermissionRequirement,
    organizationId?: string,
  ) {
    if (requirement.scope === "own") {
      return true;
    }

    const roleId =
      requirement.scope === "platform"
        ? await this.findPlatformRoleId(userId)
        : await this.findOrganizationRoleId(userId, organizationId);

    if (!roleId) return false;
    return this.roleHasPermission(roleId, requirement);
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

  private async roleHasPermission(
    roleId: string,
    requirement: PermissionRequirement,
  ) {
    const key = buildEntityPermissionKey(
      requirement.entity,
      requirement.action,
      requirement.scope,
    );
    const rolePermissions = await this.rolePermissionRepository.find({
      relations: { permissionRecord: true },
      where: { enabled: true, roleId },
    });

    if (rolePermissions.some((item) => item.permission === key)) return true;

    return rolePermissions.some((item) => {
      const permission = item.permissionRecord;
      return (
        permission?.entity === requirement.entity &&
        permission.action === requirement.action &&
        permission.scope === requirement.scope
      );
    });
  }

  async ensurePermissionCatalog(requirements: PermissionRequirement[]) {
    for (const requirement of requirements) {
      const existing = await this.permissionRepository.findOne({
        where: {
          action: requirement.action,
          entity: requirement.entity,
          scope: requirement.scope,
        },
      });
      if (existing) continue;

      await this.permissionRepository.save(
        this.permissionRepository.create({
          action: requirement.action,
          entity: requirement.entity,
          scope: requirement.scope,
        }),
      );
    }
  }
}

function parsePermissionKey(permission: string) {
  const [entity, action, scope] = permission.split(":");
  return {
    action: action as PermissionAction,
    entity,
    scope: scope as PermissionScope,
  };
}
