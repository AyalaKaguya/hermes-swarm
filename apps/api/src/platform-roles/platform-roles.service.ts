import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { DEFAULT_PERMISSION_KEYS, Permission, Role, RolePermission } from "@hermes-swarm/core";
import { IsNull, Repository } from "typeorm";
import type { ReplaceRolePermissionsPayload } from "../tenancy/tenancy.types.js";
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
    const displayName = requireText(
      payload.displayName ?? payload.name,
      "角色名称",
    );
    const name = normalizeSlug(payload.name ?? displayName, "platform-role");
    await this.assertUniqueRoleName(name);

    const role = await this.roleRepository.save(
      this.roleRepository.create({
        color: normalizeNullableText(payload.color),
        description: normalizeNullableText(payload.description),
        displayName,
        isSystem: false,
        label: displayName,
        name,
        organizationId: null,
        scope: "platform",
      }),
    );
    return toRoleDto(role);
  }

  async update(roleId: string, payload: Partial<PlatformRolePayload>) {
    const role = await this.getRoleOrThrow(roleId);
    if (payload.displayName !== undefined) {
      role.displayName = requireText(payload.displayName, "角色名称");
      role.label = role.displayName;
    }
    if (payload.name !== undefined) {
      const name = normalizeSlug(payload.name, "platform-role");
      if (name !== role.name) await this.assertUniqueRoleName(name, role.id);
      role.name = name;
    }
    if (payload.color !== undefined) {
      role.color = normalizeNullableText(payload.color);
    }
    if (payload.description !== undefined) {
      role.description = normalizeNullableText(payload.description);
    }
    return toRoleDto(await this.roleRepository.save(role));
  }

  async replacePermissions(
    roleId: string,
    payload: ReplaceRolePermissionsPayload,
  ) {
    const role = await this.getRoleOrThrow(roleId);
    const permissions = payload.permissions ?? [];

    await this.rolePermissionRepository.delete({ roleId: role.id });
    const nextPermissions = await Promise.all(
      permissions
        .filter((item) => item.permission && item.enabled !== false)
        .map((item) => this.getPermissionOrThrow(item.permission)),
    );

    return this.rolePermissionRepository.save(
      nextPermissions.map(({ key, permission }) =>
        this.rolePermissionRepository.create({
          enabled: true,
          organizationId: null,
          permission: key,
          permissionId: permission.id,
          roleId: role.id,
        }),
      ),
    );
  }

  async remove(roleId: string) {
    const role = await this.getRoleOrThrow(roleId);
    if (role.isSystem) throw new BadRequestException("系统角色不能删除");
    await this.roleRepository.delete({ id: role.id });
  }

  private async getRoleOrThrow(roleId: string) {
    const role = await this.roleRepository.findOne({
      relations: { rolePermissions: true },
      where: { id: roleId, organizationId: IsNull(), scope: "platform" },
    });
    if (!role) throw new NotFoundException("平台角色不存在");
    return role;
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
    const key = requirePlatformPermission(permissionKey);
    const [entity, action, scope] = key.split(":");
    const permission = await this.permissionRepository.findOne({
      where: {
        action: action as Permission["action"],
        entity,
        scope: scope as Permission["scope"],
      },
    });
    if (!permission) throw new BadRequestException("权限目录不存在");
    return { key, permission };
  }
}

function requireText(value: string | undefined | null, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeNullableText(value: string | null | undefined) {
  const text = value?.trim();
  return text || null;
}

function normalizeSlug(value: string | undefined, fallbackPrefix: string) {
  const slug = value
    ?.trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || `${fallbackPrefix}-${Date.now().toString(36)}`;
}

function requirePlatformPermission(permission: string | undefined) {
  const value = requireText(permission, "权限");
  const [, action, scope] = value.split(":");
  if (!["create", "read", "update", "delete"].includes(action) || scope !== "platform") {
    throw new BadRequestException("平台角色只能绑定平台范围的实体 CRUD 权限");
  }
  if (!DEFAULT_PERMISSION_KEYS.includes(value as typeof DEFAULT_PERMISSION_KEYS[number])) {
    throw new BadRequestException("权限不在默认权限目录中");
  }
  return value;
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
