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
import {
  buildRbacAbility,
  toRbacSubject,
} from "./rbac-ability.js";
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
    const ability = await this.buildAbilityForRole(roleId);
    return ability.can(
      requirement.action,
      toRbacSubject(requirement.entity, requirement.scope),
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

  private async buildAbilityForRole(roleId: string) {
    const rolePermissions = await this.rolePermissionRepository.find({
      relations: { permissionRecord: true },
      where: { enabled: true, roleId },
    });
    return buildRbacAbility(
      rolePermissions
        .map((item) => toPermissionRequirement(item))
        .filter((item): item is PermissionRequirement => Boolean(item)),
    );
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

function toPermissionRequirement(
  rolePermission: RolePermission,
): PermissionRequirement | null {
  if (rolePermission.permissionRecord) {
    return {
      action: rolePermission.permissionRecord.action,
      entity: rolePermission.permissionRecord.entity,
      scope: rolePermission.permissionRecord.scope,
    };
  }

  const [entity, action, scope] = rolePermission.permission.split(":");
  if (!entity || !isPermissionAction(action) || !isPermissionScope(scope)) {
    return null;
  }
  return { action, entity, scope };
}

function isPermissionAction(value: string): value is PermissionAction {
  return ["create", "read", "update", "delete"].includes(value);
}

function isPermissionScope(value: string): value is PermissionScope {
  return ["platform", "organization", "own"].includes(value);
}
