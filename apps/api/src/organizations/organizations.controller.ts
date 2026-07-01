import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import type {
  CreateOrganizationPayload,
  ReplaceRolePermissionsPayload,
  UpdateOrganizationPayload,
} from "../common/admin-api.types.js";
import {
  PermissionOperation,
  PermissionResource,
} from "../rbac/require-permission.decorator.js";
import { OrganizationsService } from "./organizations.service.js";

@Controller("admin")
@PermissionResource({
  entity: "organization",
  entityLabel: "组织",
  entityOrder: 20,
  purpose: "profile",
  purposeLabel: "组织资料",
  purposeOrder: 10,
  scope: "organization",
})
/**
 * Exposes current-organization and organization-list management endpoints
 * under the shared admin route namespace.
 */
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * Lists organizations managed through the admin backend.
   */
  @Get("organizations")
  @PermissionOperation({
    description: "查看平台内的组织列表。",
    entity: "organization",
    entityLabel: "组织",
    label: "查看组织列表",
    operation: "list",
    purpose: "platform_organization",
    purposeLabel: "平台组织",
    scope: "platform",
    sortOrder: 10,
  })
  list() {
    return this.organizationsService.list();
  }

  /**
   * Returns a managed organization selected by id.
   */
  @Get("organizations/:organizationId")
  @PermissionOperation({
    description: "查看当前组织的基础资料。",
    label: "查看组织资料",
    operation: "view",
    sortOrder: 10,
  })
  get(
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.get(organizationId);
  }

  /**
   * Creates a managed organization and provisions its admin infrastructure.
   */
  @Post("organizations")
  @PermissionOperation({
    description: "创建新的组织并初始化组织角色。",
    entity: "organization",
    entityLabel: "组织",
    label: "创建组织",
    operation: "create",
    purpose: "platform_organization",
    purposeLabel: "平台组织",
    scope: "platform",
    sortOrder: 20,
  })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateOrganizationPayload,
  ) {
    return this.organizationsService.create(authorization, payload);
  }

  /**
   * Updates a managed organization selected by id.
   */
  @Patch("organizations/:organizationId")
  @PermissionOperation({
    description: "更新当前组织的基础资料。",
    label: "更新组织资料",
    operation: "update_basic",
    sortOrder: 20,
  })
  update(
    @Param("organizationId") organizationId: string,
    @Body() payload: UpdateOrganizationPayload,
  ) {
    return this.organizationsService.update(
      organizationId,
      payload,
    );
  }

  /**
   * Deletes a managed organization selected by id.
   */
  @Delete("organizations/:organizationId")
  @PermissionOperation({
    description: "删除平台中的组织。",
    entity: "organization",
    entityLabel: "组织",
    isDangerous: true,
    label: "删除组织",
    operation: "delete",
    purpose: "platform_organization",
    purposeLabel: "平台组织",
    scope: "platform",
    sortOrder: 90,
  })
  delete(
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.delete(organizationId);
  }

  /**
   * Lists roles in a managed organization selected by id.
   */
  @Get("organizations/:organizationId/roles")
  @PermissionOperation({
    description: "查看当前组织的角色列表。",
    entity: "role",
    entityLabel: "角色",
    entityOrder: 30,
    label: "查看角色列表",
    operation: "list",
    purpose: "organization_role",
    purposeLabel: "组织角色",
    purposeOrder: 10,
    sortOrder: 10,
  })
  listRoles(
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.listRoles(organizationId);
  }

  /**
   * Creates a role in a managed organization selected by id.
   */
  @Post("organizations/:organizationId/roles")
  @PermissionOperation({
    description: "创建当前组织内的自定义角色。",
    entity: "role",
    entityLabel: "角色",
    entityOrder: 30,
    label: "创建角色",
    operation: "create",
    purpose: "organization_role",
    purposeLabel: "组织角色",
    purposeOrder: 10,
    sortOrder: 20,
  })
  createRole(
    @Param("organizationId") organizationId: string,
    @Body() payload: OrganizationRolePayload,
  ) {
    return this.organizationsService.createRole(
      organizationId,
      payload,
    );
  }

  /**
   * Updates a role in a managed organization selected by id.
   */
  @Patch("organizations/:organizationId/roles/:roleId")
  @PermissionOperation({
    description: "更新当前组织角色的名称、颜色和描述。",
    entity: "role",
    entityLabel: "角色",
    entityOrder: 30,
    label: "更新角色",
    operation: "update_basic",
    purpose: "organization_role",
    purposeLabel: "组织角色",
    purposeOrder: 10,
    sortOrder: 30,
  })
  updateRole(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
    @Body() payload: Partial<OrganizationRolePayload>,
  ) {
    return this.organizationsService.updateRole(
      organizationId,
      roleId,
      payload,
    );
  }

  /**
   * Replaces a role permission set with entity CRUD permissions.
   */
  @Put("organizations/:organizationId/roles/:roleId/permissions")
  @PermissionOperation({
    description: "替换当前组织角色拥有的权限。",
    entity: "role",
    entityLabel: "角色",
    entityOrder: 30,
    isDangerous: true,
    label: "配置角色权限",
    operation: "replace_permissions",
    purpose: "organization_role",
    purposeLabel: "组织角色",
    purposeOrder: 10,
    sortOrder: 40,
  })
  replaceRolePermissions(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
    @Body() payload: ReplaceRolePermissionsPayload,
  ) {
    return this.organizationsService.replaceRolePermissions(
      organizationId,
      roleId,
      payload,
    );
  }

  /**
   * Deletes a role in a managed organization selected by id.
   */
  @Delete("organizations/:organizationId/roles/:roleId")
  @PermissionOperation({
    description: "删除当前组织内的自定义角色。",
    entity: "role",
    entityLabel: "角色",
    entityOrder: 30,
    isDangerous: true,
    label: "删除角色",
    operation: "delete",
    purpose: "organization_role",
    purposeLabel: "组织角色",
    purposeOrder: 10,
    sortOrder: 90,
  })
  deleteRole(
    @Param("organizationId") organizationId: string,
    @Param("roleId") roleId: string,
  ) {
    return this.organizationsService.deleteRole(
      organizationId,
      roleId,
    );
  }
}

export type OrganizationRolePayload = {
  color?: string | null;
  description?: string | null;
  displayName?: string;
  name?: string;
};
