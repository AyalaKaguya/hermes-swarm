import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
} from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { TenantsService } from "./tenants.service.js";
import type {
  PrincipalRequest,
  TenantRolePayload,
  TenantRolePermissionsPayload,
} from "./tenants.controller.js";

@Controller("admin/roles")
@AccessResource({
  entity: "role",
  entityLabel: "角色",
  purpose: "workspace_role",
  purposeLabel: "角色与权限",
  scope: "tenant",
})
export class RolesController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    label: "查看角色",
    operation: "list",
  })
  list(@Req() request: PrincipalRequest) {
    return this.tenantsService.listTenantRoles(requireTenantId(request));
  }

  @Post()
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    label: "创建角色",
    operation: "create",
  })
  create(@Req() request: PrincipalRequest, @Body() payload: TenantRolePayload) {
    return this.tenantsService.createTenantRole(requireTenantId(request), payload);
  }

  @Patch(":roleId")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    label: "更新角色",
    operation: "update",
  })
  update(
    @Req() request: PrincipalRequest,
    @Param("roleId") roleId: string,
    @Body() payload: Partial<TenantRolePayload>,
  ) {
    return this.tenantsService.updateTenantRole(requireTenantId(request), roleId, payload);
  }

  @Put(":roleId/permissions")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    isDangerous: true,
    label: "配置角色权限",
    operation: "replace_permissions",
  })
  replacePermissions(
    @Req() request: PrincipalRequest,
    @Param("roleId") roleId: string,
    @Body() payload: TenantRolePermissionsPayload,
  ) {
    return this.tenantsService.replaceTenantRolePermissions(
      requireTenantId(request),
      roleId,
      payload,
      request.accessPrincipal?.userId,
    );
  }

  @Delete(":roleId")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    isDangerous: true,
    label: "删除角色",
    operation: "delete",
  })
  remove(@Req() request: PrincipalRequest, @Param("roleId") roleId: string) {
    return this.tenantsService.deleteTenantRole(requireTenantId(request), roleId);
  }
}

function requireTenantId(request: PrincipalRequest) {
  const tenantId = request.accessPrincipal?.tenantId?.trim();
  if (!tenantId) throw new Error("Tenant context was not established by the access guard.");
  return tenantId;
}
