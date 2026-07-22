import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Permission,
  PlatformMembership,
  Role,
  RolePermission,
} from "@hermes-swarm/core";
import { IsNull, Repository } from "typeorm";
import type { ReplaceRolePermissionsPayload } from "../../common/admin-api.types.js";
import type { PlatformRolePayload } from "./platform-roles.controller.js";
import { RoleGrantPolicyService } from "@hermes-swarm/rbac";

@Injectable()
export class PlatformRolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roleRepository: Repository<Role>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @InjectRepository(Permission)
    private readonly permissionRepository: Repository<Permission>,
    private readonly grantPolicy: RoleGrantPolicyService =
      new RoleGrantPolicyService(),
  ) {}

  async list() {
    const roles = await this.roleRepository.find({
      order: { createdAt: "ASC" },
      relations: { rolePermissions: { permissionRecord: true } },
      where: { scope: "platform", workspaceId: IsNull() },
    });
    return roles.map(toRoleDto);
  }

  async create(payload: PlatformRolePayload) {
    const input = requirePayload(payload);
    const label = requireText(input.displayName ?? input.name, "角色名称");
    const name = normalizeSlug(input.name ?? label, "platform-role");
    await this.assertUniqueRoleName(name);
    try {
      return toRoleDto(
        await this.roleRepository.save(
          this.roleRepository.create({
            color: normalizeNullableText(input.color),
            description: normalizeNullableText(input.description),
            displayName: label,
            isSystem: false,
            label,
            name,
            scope: "platform",
            workspaceId: null,
          }),
        ),
      );
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new BadRequestException("角色标识已被使用");
      }
      throw error;
    }
  }

  async update(roleId: string, payload: Partial<PlatformRolePayload>) {
    const input = requirePayload(payload);
    const role = await this.getRoleOrThrow(roleId);
    this.assertMutableRole(role);
    if (input.displayName !== undefined) {
      role.label = requireText(input.displayName, "角色名称");
      role.displayName = role.label;
    }
    if (input.name !== undefined) {
      const name = normalizeSlug(input.name, "platform-role");
      if (name !== role.name) await this.assertUniqueRoleName(name, role.id);
      role.name = name;
    }
    if (input.color !== undefined) role.color = normalizeNullableText(input.color);
    if (input.description !== undefined) {
      role.description = normalizeNullableText(input.description);
    }
    return toRoleDto(await this.roleRepository.save(role));
  }

  async replacePermissions(
    roleId: string,
    payload: ReplaceRolePermissionsPayload,
    actorAccountId?: string,
  ) {
    const role = await this.getRoleOrThrow(roleId);
    this.assertMutableRole(role);
    const permissionKeys = requirePermissionKeys(payload);
    const permissions = await Promise.all(
      permissionKeys.map((key) => this.getPermissionOrThrow(key)),
    );
    if (actorAccountId) {
      const actor = await this.roleRepository.manager.findOne(PlatformMembership, {
        relations: { role: { rolePermissions: { permissionRecord: true } } },
        where: { accountId: actorAccountId, status: "active" },
      });
      const actorPermissions = [
        ...new Set(
          (actor?.role?.rolePermissions ?? [])
            .filter((item) => item.enabled)
            .flatMap((item) =>
              item.permissionRecord?.code ? [item.permissionRecord.code] : [],
            ),
        ),
      ];
      this.grantPolicy.assertCanReplacePermissions(
        actorPermissions,
        permissions.flatMap((permission) =>
          permission.code ? [permission.code] : [],
        ),
      );
    }
    return this.rolePermissionRepository.manager.transaction(async (manager) => {
      await manager.delete(RolePermission, { roleId: role.id });
      const rows = permissions.map((permission) =>
        manager.create(RolePermission, {
          enabled: true,
          permissionId: permission.id,
          roleId: role.id,
        }),
      );
      return rows.length ? manager.save(RolePermission, rows) : [];
    });
  }

  async remove(roleId: string) {
    const role = await this.getRoleOrThrow(roleId);
    this.assertMutableRole(role);
    await this.roleRepository.manager.transaction(async (manager) => {
      const assigned = await manager.count(PlatformMembership, {
        where: { roleId: role.id },
      });
      if (assigned > 0) {
        throw new BadRequestException("角色仍被平台成员使用，不能删除");
      }
      await manager.delete(RolePermission, { roleId: role.id });
      await manager.delete(Role, { id: role.id, scope: "platform" });
    });
  }

  private async getRoleOrThrow(roleId: string) {
    const role = await this.roleRepository.findOne({
      relations: { rolePermissions: { permissionRecord: true } },
      where: { id: roleId, scope: "platform", workspaceId: IsNull() },
    });
    if (!role) throw new NotFoundException("平台角色不存在");
    return role;
  }

  private assertMutableRole(role: Role) {
    if (role.isSystem || role.name === "platform-admin") {
      throw new BadRequestException("系统平台角色不能修改或删除");
    }
  }

  private async assertUniqueRoleName(name: string, exceptRoleId?: string) {
    const existing = await this.roleRepository.findOne({
      where: { name, scope: "platform", workspaceId: IsNull() },
    });
    if (existing && existing.id !== exceptRoleId) {
      throw new BadRequestException("角色标识已被使用");
    }
  }

  private async getPermissionOrThrow(code: string) {
    const permission = await this.permissionRepository.findOne({
      where: { code, scope: "platform" },
    });
    if (!permission) throw new BadRequestException("平台权限目录不存在");
    return permission;
  }
}

function requirePayload(value: object | null | undefined) {
  if (!value || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value as Partial<PlatformRolePayload>;
}

function requireText(value: unknown, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

function normalizeNullableText(value: unknown) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw new BadRequestException("文本格式不正确");
  return value.trim() || null;
}

function normalizeSlug(value: unknown, prefix: string) {
  const slug = typeof value === "string"
    ? value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
    : "";
  return slug || `${prefix}-${Date.now().toString(36)}`;
}

function requirePermissionKeys(payload: ReplaceRolePermissionsPayload) {
  if (!payload || !Array.isArray(payload.permissions)) return [];
  return payload.permissions
    .filter((item) => item?.enabled !== false)
    .map((item) => requireText(item.permission, "权限"));
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
    permissions: role.rolePermissions?.map((item) => ({
      enabled: item.enabled,
      id: item.id,
      permission: item.permissionRecord?.code ?? "",
      permissionId: item.permissionId,
      roleId: item.roleId,
    })) ?? [],
    scope: "platform" as const,
  };
}
