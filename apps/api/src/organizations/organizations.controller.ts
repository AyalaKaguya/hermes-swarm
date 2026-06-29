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
} from "../tenancy/tenancy.types.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { OrganizationsService } from "./organizations.service.js";

@Controller("admin")
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
  @RequirePermission({
    action: "read",
    entity: "organization",
    scope: "platform",
  })
  list() {
    return this.organizationsService.list();
  }

  /**
   * Returns a managed organization selected by id.
   */
  @Get("organizations/:organizationId")
  @RequirePermission({
    action: "read",
    entity: "organization",
    scope: "organization",
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
  @RequirePermission({
    action: "create",
    entity: "organization",
    scope: "platform",
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
  @RequirePermission({
    action: "update",
    entity: "organization",
    scope: "organization",
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
  @RequirePermission({
    action: "delete",
    entity: "organization",
    scope: "platform",
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
  @RequirePermission({
    action: "read",
    entity: "role",
    scope: "organization",
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
  @RequirePermission({
    action: "create",
    entity: "role",
    scope: "organization",
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
  @RequirePermission({
    action: "update",
    entity: "role",
    scope: "organization",
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
  @RequirePermission({
    action: "update",
    entity: "role",
    scope: "organization",
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
  @RequirePermission({
    action: "delete",
    entity: "role",
    scope: "organization",
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
