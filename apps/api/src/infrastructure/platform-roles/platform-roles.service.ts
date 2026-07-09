import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  IntegrationToken,
  Permission,
  PlatformMember,
  Role,
  RolePermission,
} from "@hermes-swarm/core";
import { In, IsNull, Repository, type EntityManager } from "typeorm";
import type { ReplaceRolePermissionsPayload } from "../../common/admin-api.types.js";
import type { PlatformRolePayload } from "./platform-roles.controller.js";

@Injectable()
export class PlatformRolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
  ) {}

  async list() {
    const roles = await this.roleRepository.find({
      order: { createdAt: "ASC" },
      relations: { rolePermissions: true },
      where: { organizationId: IsNull(), scope: "platform" },
    });
    return roles.map(toRoleDto);
  }

  async create(payload: PlatformRolePayload) {
    const input = requirePlatformRolePayload(payload);
    const displayName = requireText(
      input.displayName ?? input.name,
      "角色名称",
    );
    const name = normalizeSlug(input.name ?? displayName, "platform-role");
    await this.assertUniqueRoleName(name);

    let role: Role;
    try {
      role = await this.roleRepository.save(
        this.roleRepository.create({
          color: normalizeNullableText(input.color),
          description: normalizeNullableText(input.description),
          displayName,
          isSystem: false,
          label: displayName,
          name,
          organizationId: null,
          scope: "platform",
        }),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("角色标识已被使用");
      }
      throw error;
    }
    return toRoleDto(role);
  }

  async update(roleId: string, payload: Partial<PlatformRolePayload>) {
    const input = requirePlatformRolePayload(payload);
    const role = await this.getRoleOrThrow(roleId);
    this.assertMutableRole(role);
    if (input.displayName !== undefined) {
      role.displayName = requireText(input.displayName, "角色名称");
      role.label = role.displayName;
    }
    if (input.name !== undefined) {
      const name = normalizeSlug(input.name, "platform-role");
      if (name !== role.name) await this.assertUniqueRoleName(name, role.id);
      role.name = name;
    }
    if (input.color !== undefined) {
      role.color = normalizeNullableText(input.color);
    }
    if (input.description !== undefined) {
      role.description = normalizeNullableText(input.description);
    }
    try {
      return toRoleDto(await this.roleRepository.save(role));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("角色标识已被使用");
      }
      throw error;
    }
  }

  async replacePermissions(
    roleId: string,
    payload: ReplaceRolePermissionsPayload,
  ) {
    const role = await this.getRoleOrThrow(roleId);
    this.assertMutableRole(role);
    const permissions = requireReplaceRolePermissionsPayload(payload);

    const nextPermissions = await Promise.all(
      permissions
        .filter((item) => item.enabled !== false)
        .map((item) => this.getPermissionOrThrow(item.permission)),
    );

    let saved: RolePermission[] = [];
    await this.rolePermissionRepository.manager.transaction(async (manager) => {
      await revokePlatformIntegrationTokensForRole(manager, role.id);
      await manager.delete(RolePermission, { roleId: role.id });
      const nextRows = nextPermissions.map(({ key, permission }) =>
        this.rolePermissionRepository.create({
          enabled: true,
          organizationId: null,
          permission: key,
          permissionId: permission.id,
          roleId: role.id,
        }),
      );
      saved =
        nextRows.length > 0
          ? await manager.save(RolePermission, nextRows)
          : [];
    });
    return saved;
  }

  async remove(roleId: string) {
    const role = await this.getRoleOrThrow(roleId);
    this.assertDeletableRole(role);
    await this.roleRepository.manager.transaction(async (manager) => {
      await revokePlatformIntegrationTokensForRole(manager, role.id);
      await manager.update(PlatformMember, { roleId: role.id }, { roleId: null });
      await manager.delete(RolePermission, { roleId: role.id });
      await manager.delete(Role, { id: role.id });
    });
  }

  private async getRoleOrThrow(roleId: string) {
    const role = await this.roleRepository.findOne({
      relations: { rolePermissions: true },
      where: { id: roleId, organizationId: IsNull(), scope: "platform" },
    });
    if (!role) throw new NotFoundException("平台角色不存在");
    return role;
  }

  private assertMutableRole(role: Role) {
    if (role.isSystem || role.name === "platform-admin") {
      throw new BadRequestException("系统平台角色不能修改");
    }
  }

  private assertDeletableRole(role: Role) {
    if (role.isSystem || role.name === "platform-admin") {
      throw new BadRequestException("系统角色不能删除");
    }
  }

  private async assertUniqueRoleName(name: string, exceptRoleId?: string) {
    const existing = await this.roleRepository.findOne({
      where: { name, organizationId: IsNull(), scope: "platform" },
    });
    if (existing && existing.id !== exceptRoleId) {
      throw new BadRequestException("角色标识已被使用");
    }
  }

  private async getPermissionOrThrow(permissionKey: string | undefined) {
    const key = requirePermissionCode(permissionKey);
    const permission = await this.permissionRepository.findOne({
      where: {
        code: key,
        scope: "platform",
      },
    });
    if (!permission) throw new BadRequestException("权限目录不存在");
    return { key, permission };
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string") {
    throw new BadRequestException(`${label}格式不正确`);
  }
  const text = value.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function requirePlatformRolePayload(
  value: PlatformRolePayload | Partial<PlatformRolePayload>,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value;
}

function normalizeNullableText(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new BadRequestException("文本格式不正确");
  }
  const text = value.trim();
  return text || null;
}

function normalizeSlug(value: unknown, fallbackPrefix: string) {
  if (value !== undefined && typeof value !== "string") {
    throw new BadRequestException("标识格式不正确");
  }
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `${fallbackPrefix}-${Date.now().toString(36)}`;
}

function requirePermissionCode(permission: string | undefined) {
  const value = requireText(permission, "权限");
  return value;
}

function requireReplaceRolePermissionsPayload(
  value: ReplaceRolePermissionsPayload,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  if (value.permissions === undefined || value.permissions === null) {
    return [];
  }
  if (!Array.isArray(value.permissions)) {
    throw new BadRequestException("权限列表格式不正确");
  }

  return value.permissions.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      throw new BadRequestException("权限项格式不正确");
    }
    if (item.enabled !== undefined && typeof item.enabled !== "boolean") {
      throw new BadRequestException("权限启用状态格式不正确");
    }
    if (item.enabled !== false) {
      requirePermissionCode(item.permission);
    }
    return item;
  });
}

async function revokePlatformIntegrationTokensForRole(
  manager: EntityManager,
  roleId: string,
) {
  const members = await manager.find(PlatformMember, {
    select: { userId: true },
    where: { roleId },
  });
  const userIds = [...new Set(members.map((member) => member.userId))];
  if (userIds.length === 0) return;

  await manager.update(
    IntegrationToken,
    {
      organizationId: IsNull(),
      ownerUserId: In(userIds),
      revokedAt: IsNull(),
      scope: "platform",
    },
    { revokedAt: new Date() },
  );
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as { code?: string; driverError?: { code?: string } };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}

function toRoleDto(role: Role) {
  return {
    color: role.color,
    description: role.description,
    displayName: role.displayName ?? role.label,
    id: role.id,
    isSystem: role.isSystem,
    label: role.label,
    name: role.name,
    organizationId: role.organizationId,
    permissions: role.rolePermissions?.map((permission) => ({
      enabled: permission.enabled,
      id: permission.id,
        permission: permission.permission,
        permissionId: permission.permissionId,
        roleId: permission.roleId,
    })) ?? [],
    scope: role.scope,
  };
}
