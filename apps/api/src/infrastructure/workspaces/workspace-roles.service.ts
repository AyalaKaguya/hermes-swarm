import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Permission,
  Role,
  RolePermission,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { RoleGrantPolicyService } from "@hermes-swarm/rbac";
import { Repository } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import type {
  WorkspaceRolePayload,
  WorkspaceRolePermissionsPayload,
} from "./workspace.types.js";

const RESERVED_ROLE_NAMES = new Set([
  "workspace-owner",
  "workspace-admin",
  "workspace-member",
]);

@Injectable()
export class WorkspaceRolesService {
  constructor(
    @InjectRepository(Role)
    private readonly roles: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permissions: Repository<Permission>,
    @InjectRepository(RolePermission)
    private readonly rolePermissions: Repository<RolePermission>,
    @InjectRepository(WorkspaceMembership)
    private readonly memberships: Repository<WorkspaceMembership>,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly grantPolicy: RoleGrantPolicyService = new RoleGrantPolicyService(),
  ) {}

  async list(workspaceId: string) {
    const id = this.requireWorkspace(workspaceId);
    const roles = await this.roles.find({
      order: { createdAt: "ASC" },
      relations: { rolePermissions: { permissionRecord: true } },
      where: { scope: "workspace", workspaceId: id },
    });
    return roles.map(toRoleDto);
  }

  async create(workspaceId: string, payload: WorkspaceRolePayload) {
    const id = this.requireWorkspace(workspaceId);
    requireObject(payload, "角色");
    const displayName = requireText(payload.displayName ?? payload.name, "角色名称");
    const name = normalizeRoleName(payload.name ?? displayName);
    assertCustomRoleName(name);
    if (await this.roles.findOne({ where: { name, scope: "workspace", workspaceId: id } })) {
      throw new BadRequestException("角色标识已被使用");
    }
    return toRoleDto(
      await this.roles.save(
        this.roles.create({
          color: normalizeNullableText(payload.color),
          description: normalizeNullableText(payload.description),
          displayName,
          isSystem: false,
          label: displayName,
          name,
          scope: "workspace",
          workspaceId: id,
        }),
      ),
    );
  }

  async update(
    workspaceId: string,
    roleId: string,
    payload: Partial<WorkspaceRolePayload>,
  ) {
    const id = this.requireWorkspace(workspaceId);
    requireObject(payload, "角色");
    const role = await this.requireRole(id, roleId);
    if (payload.name !== undefined) {
      const name = normalizeRoleName(payload.name);
      if (role.isSystem && name !== role.name) {
        throw new BadRequestException("系统工作空间角色标识不能修改");
      }
      if (!role.isSystem) assertCustomRoleName(name);
      const duplicate = await this.roles.findOne({
        where: { name, scope: "workspace", workspaceId: id },
      });
      if (duplicate && duplicate.id !== role.id) {
        throw new BadRequestException("角色标识已被使用");
      }
      role.name = name;
    }
    if (payload.displayName !== undefined) {
      role.displayName = requireText(payload.displayName, "角色名称");
      role.label = role.displayName;
    }
    if (payload.color !== undefined) role.color = normalizeNullableText(payload.color);
    if (payload.description !== undefined) role.description = normalizeNullableText(payload.description);
    return toRoleDto(await this.roles.save(role));
  }

  async replacePermissions(
    workspaceId: string,
    roleId: string,
    payload: WorkspaceRolePermissionsPayload,
    actorUserId?: string,
  ) {
    const id = this.requireWorkspace(workspaceId);
    const role = await this.requireRole(id, roleId);
    if (role.name === "workspace-owner") {
      throw new BadRequestException("Workspace Owner 权限不能修改");
    }
    if (!payload || !Array.isArray(payload.permissions)) {
      throw new BadRequestException("权限列表格式不正确");
    }
    const requestedCodes = [
      ...new Set(
        payload.permissions
          .filter((item) => item?.enabled !== false)
          .map((item) => requireText(item?.permission, "权限")),
      ),
    ];
    const permissions: Permission[] = [];
    for (const code of requestedCodes) {
      const permission = await this.permissions.findOne({ where: { code } });
      if (!permission || (permission.scope !== "workspace" && permission.scope !== "own")) {
        throw new BadRequestException(`角色权限范围不匹配: ${code}`);
      }
      permissions.push(permission);
    }
    if (actorUserId) await this.assertActorMayGrant(actorUserId, id, permissions);
    await this.rolePermissions.manager.transaction(async (manager) => {
      const lockedRole = await manager.findOne(Role, {
        lock: { mode: "pessimistic_write" },
        where: { id: roleId, scope: "workspace", workspaceId: id },
      });
      if (!lockedRole) throw new NotFoundException("工作空间角色不存在");
      await manager.delete(RolePermission, { roleId });
      if (permissions.length) {
        await manager.save(
          RolePermission,
          permissions.map((permission) => ({
            enabled: true,
            permissionId: permission.id,
            roleId,
          })),
        );
      }
    });
    return toRoleDto(await this.requireRole(id, roleId, true));
  }

  async remove(workspaceId: string, roleId: string) {
    const id = this.requireWorkspace(workspaceId);
    const role = await this.requireRole(id, roleId);
    if (role.isSystem) throw new BadRequestException("系统工作空间角色不能删除");
    await this.roles.manager.transaction(async (manager) => {
      if (await manager.exists(WorkspaceMembership, { where: { roleId, workspaceId: id } })) {
        throw new ConflictException("角色仍分配给工作空间用户，不能删除");
      }
      await manager.delete(RolePermission, { roleId });
      await manager.delete(Role, { id: roleId, workspaceId: id });
    });
    return { success: true };
  }

  private async assertActorMayGrant(
    actorUserId: string,
    workspaceId: string,
    permissions: Permission[],
  ) {
    const assignments = await this.memberships.find({
      relations: { role: { rolePermissions: { permissionRecord: true } } },
      where: { accountId: actorUserId, status: "active", workspaceId },
    });
    this.grantPolicy.assertCanReplacePermissions(
      assignments.flatMap((assignment) =>
        (assignment.role?.rolePermissions ?? [])
          .filter((permission) => permission.enabled)
          .map((permission) => permission.permission),
      ),
      permissions.flatMap((permission) => permission.code ? [permission.code] : []),
    );
  }

  private async requireRole(workspaceId: string, roleId: string, withPermissions = false) {
    const role = await this.roles.findOne({
      relations: withPermissions ? { rolePermissions: { permissionRecord: true } } : undefined,
      where: {
        id: requireText(roleId, "角色"),
        scope: "workspace",
        workspaceId,
      },
    });
    if (!role) throw new NotFoundException("工作空间角色不存在");
    return role;
  }

  private requireWorkspace(workspaceId: string) {
    const id = requireText(workspaceId, "工作空间");
    if (this.workspaceContext.current()!.workspaceId !== id) {
      throw new NotFoundException("工作空间不存在");
    }
    return id;
  }
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function normalizeRoleName(value: unknown) {
  const name = requireText(value, "工作空间标识")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!name) throw new BadRequestException("工作空间标识格式不正确");
  return name;
}

function normalizeNullableText(value: unknown) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") throw new BadRequestException("文本格式不正确");
  return value.trim() || null;
}

function requireObject(value: unknown, label: string): asserts value is object {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException(`${label}内容无效`);
  }
}

function assertCustomRoleName(name: string) {
  if (RESERVED_ROLE_NAMES.has(name)) {
    throw new BadRequestException("系统工作空间角色标识不能用于自定义角色");
  }
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
    permissions: (role.rolePermissions ?? []).map((permission) => ({
      enabled: permission.enabled,
      id: permission.id,
      permission: permission.permission,
      permissionId: permission.permissionId,
      roleId: permission.roleId,
    })),
    scope: role.scope,
    workspaceId: role.workspaceId,
  };
}
