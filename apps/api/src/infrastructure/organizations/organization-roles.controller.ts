import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import type {
  TenantRolePayload,
  TenantRolePermissionsPayload,
} from "../tenants/tenants.controller.js";
import { OrganizationRolesService } from "./organization-roles.service.js";

@Controller("admin/organizations/:organizationId/roles")
@AccessResource({
  entity: "role",
  entityLabel: "角色",
  purpose: "organization_role",
  purposeLabel: "角色与权限",
  scope: "organization",
})
export class OrganizationRolesController {
  constructor(private readonly roles: OrganizationRolesService) {}

  @Get()
  @AccessOperation({ defaultRoles: ["owner", "admin"], label: "查看角色", operation: "list" })
  list(@Param("organizationId") organizationId: string) {
    return this.roles.list(organizationId);
  }

  @Post()
  @AccessOperation({ defaultRoles: ["owner", "admin"], label: "创建角色", operation: "create" })
  create(@Param("organizationId") organizationId: string, @Body() payload: TenantRolePayload) {
    return this.roles.create(organizationId, payload);
  }

  @Patch(":roleId")
  @AccessOperation({ defaultRoles: ["owner", "admin"], label: "更新角色", operation: "update" })
  update(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
    @Body() payload: Partial<TenantRolePayload>,
  ) {
    return this.roles.update(organizationId, roleId, payload);
  }

  @Put(":roleId/permissions")
  @AccessOperation({ defaultRoles: ["owner"], isDangerous: true, label: "配置角色权限", operation: "replace_permissions" })
  permissions(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
    @Body() payload: TenantRolePermissionsPayload,
  ) {
    return this.roles.replacePermissions(organizationId, roleId, payload);
  }

  @Delete(":roleId")
  @AccessOperation({ defaultRoles: ["owner"], isDangerous: true, label: "删除角色", operation: "delete" })
  remove(@Param("organizationId") organizationId: string, @Param("roleId") roleId: string) {
    return this.roles.remove(organizationId, roleId);
  }
}
