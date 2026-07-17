import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import {
  Permission,
  Role,
  RolePermission,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { In } from "typeorm";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import type {
  TenantRolePayload,
  TenantRolePermissionsPayload,
} from "../tenants/tenants.controller.js";

const DEFAULT_ORGANIZATION_ROLES = [
  { description: "拥有当前组织的全部权限。", label: "Owner", name: "owner" },
  { description: "管理当前组织的成员与业务。", label: "Admin", name: "admin" },
  { description: "参与当前组织的日常业务。", label: "Member", name: "member" },
  { description: "只读访问当前组织。", label: "Viewer", name: "viewer" },
] as const;

@Injectable()
export class OrganizationRolesService {
  constructor(private readonly tenantContext: TenantContextService) {}

  async list(organizationId: string) {
    await this.requireOrganization(organizationId);
    return (
      await this.roles.find({
        order: { createdAt: "ASC" },
        relations: { rolePermissions: true },
        where: {
          organizationId,
          scope: "organization",
          tenantId: this.tenantId,
        },
      })
    ).map(toRoleDto);
  }

  async create(organizationId: string, payload: TenantRolePayload) {
    await this.requireOrganization(organizationId);
    const displayName = requireText(payload?.displayName ?? payload?.name, "角色名称");
    const name = normalizeSlug(payload?.name ?? displayName);
    if (DEFAULT_ORGANIZATION_ROLES.some((role) => role.name === name)) {
      throw new BadRequestException("系统组织角色标识不能用于自定义角色");
    }
    if (await this.roles.findOne({ where: { name, organizationId, tenantId: this.tenantId } })) {
      throw new ConflictException("当前组织已存在同名角色");
    }
    return toRoleDto(
      await this.roles.save(
        this.roles.create({
          color: nullableText(payload?.color),
          description: nullableText(payload?.description),
          displayName,
          isSystem: false,
          label: displayName,
          name,
          organizationId,
          scope: "organization",
          tenantId: this.tenantId,
        }),
      ),
    );
  }

  async update(organizationId: string, roleId: string, payload: Partial<TenantRolePayload>) {
    const role = await this.requireRole(organizationId, roleId);
    if (payload.name !== undefined) {
      const name = normalizeSlug(payload.name);
      if (role.isSystem && name !== role.name) {
        throw new BadRequestException("系统组织角色标识不能修改");
      }
      const duplicate = await this.roles.findOne({
        where: { name, organizationId, tenantId: this.tenantId },
      });
      if (duplicate && duplicate.id !== role.id) {
        throw new ConflictException("当前组织已存在同名角色");
      }
      role.name = name;
    }
    if (payload.displayName !== undefined) {
      role.displayName = requireText(payload.displayName, "角色名称");
      role.label = role.displayName;
    }
    if (payload.color !== undefined) role.color = nullableText(payload.color);
    if (payload.description !== undefined) role.description = nullableText(payload.description);
    return toRoleDto(await this.roles.save(role));
  }

  async replacePermissions(
    organizationId: string,
    roleId: string,
    payload: TenantRolePermissionsPayload,
  ) {
    const role = await this.requireRole(organizationId, roleId);
    if (role.name === "owner") {
      throw new BadRequestException("组织 Owner 必须保留全部组织权限");
    }
    if (!payload || !Array.isArray(payload.permissions)) {
      throw new BadRequestException("权限列表格式不正确");
    }
    const codes = [...new Set(
      payload.permissions
        .filter((item) => item?.enabled !== false)
        .map((item) => requireText(item?.permission, "权限")),
    )];
    const permissions = codes.length
      ? await this.tenantContext.repository(Permission).find({
          where: { code: In(codes), scope: "organization" },
        })
      : [];
    if (permissions.length !== codes.length) {
      throw new BadRequestException("角色包含非组织权限");
    }
    await this.manager.delete(RolePermission, { roleId, tenantId: this.tenantId });
    if (permissions.length) {
      await this.manager.insert(
        RolePermission,
        permissions.map((permission) => ({
          enabled: true,
          permission: permission.code!,
          permissionId: permission.id,
          roleId,
          tenantId: this.tenantId,
        })),
      );
    }
    return toRoleDto(await this.requireRole(organizationId, roleId, true));
  }

  async remove(organizationId: string, roleId: string) {
    const role = await this.requireRole(organizationId, roleId);
    if (role.isSystem) throw new BadRequestException("系统组织角色不能删除");
    if (await this.manager.exists(UserOrganizationRole, {
      where: { organizationId, roleId, tenantId: this.tenantId },
    })) {
      throw new ConflictException("角色仍分配给组织成员，不能删除");
    }
    await this.manager.delete(RolePermission, { roleId, tenantId: this.tenantId });
    await this.manager.delete(Role, { id: roleId, organizationId, tenantId: this.tenantId });
    return { success: true };
  }

  async bootstrap(organizationId: string) {
    const definitions = await this.tenantContext.repository(Permission).find({
      where: { scope: "organization" },
    });
    const created = new Map<string, Role>();
    for (const preset of DEFAULT_ORGANIZATION_ROLES) {
      const role = await this.roles.save(this.roles.create({
        color: "#2563eb",
        description: preset.description,
        displayName: preset.label,
        isSystem: true,
        label: preset.label,
        name: preset.name,
        organizationId,
        scope: "organization",
        tenantId: this.tenantId,
      }));
      const allowed = preset.name === "owner"
        ? definitions
        : definitions.filter((permission) => permission.defaultRoles?.includes(preset.name));
      if (allowed.length) {
        await this.manager.insert(RolePermission, allowed.map((permission) => ({
          enabled: true,
          permission: permission.code!,
          permissionId: permission.id,
          roleId: role.id,
          tenantId: this.tenantId,
        })));
      }
      created.set(preset.name, role);
    }
    return created;
  }

  private async requireRole(organizationId: string, roleId: string, permissions = false) {
    const role = await this.roles.findOne({
      relations: permissions ? { rolePermissions: true } : undefined,
      where: { id: roleId, organizationId, scope: "organization", tenantId: this.tenantId },
    });
    if (!role) throw new NotFoundException("组织角色不存在");
    return role;
  }

  private async requireOrganization(organizationId: string) {
    const organization = await this.manager.query(
      `SELECT id FROM organizations WHERE id = $1 AND tenant_id = $2 AND deleted_at IS NULL`,
      [organizationId, this.tenantId],
    ) as Array<{ id: string }>;
    if (!organization.length) throw new NotFoundException("组织不存在");
  }

  private get roles() { return this.tenantContext.repository(Role); }
  private get manager() { return this.tenantContext.current()!.manager; }
  private get tenantId() { return this.tenantContext.current()!.tenantId; }
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
    permissions: (role.rolePermissions ?? []).map((permission) => ({
      enabled: permission.enabled,
      id: permission.id,
      permission: permission.permission,
      permissionId: permission.permissionId,
      roleId: permission.roleId,
    })),
    scope: role.scope,
    tenantId: role.tenantId,
  };
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function normalizeSlug(value: unknown) {
  const slug = requireText(value, "角色标识").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new BadRequestException("角色标识格式不正确");
  return slug;
}

function nullableText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException("文本格式不正确");
  return value.trim() || null;
}
