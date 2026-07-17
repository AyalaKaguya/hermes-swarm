import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import type {
  CreateOrganizationPayload,
  UpdateOrganizationPayload,
} from "../../common/admin-api.types.js";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import { OrganizationsService } from "./organizations.service.js";
import type { PrincipalRequest } from "../tenants/tenants.controller.js";

@Controller("admin")
@AccessResource({
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
  constructor(
    @Inject(OrganizationsService)
    private readonly organizationsService: OrganizationsService,
  ) {}

  /**
   * Lists organizations managed through the admin backend.
   */
  @Get("organizations")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin", "tenant-member"],
    description: "查看当前工作空间内的组织目录。",
    entity: "organization",
    entityLabel: "组织",
    label: "查看组织列表",
    operation: "list",
    purpose: "tenant_organization",
    purposeLabel: "工作空间组织",
    scope: "tenant",
    sortOrder: 10,
  })
  list() {
    return this.organizationsService.list();
  }

  /**
   * Returns a managed organization selected by id.
   */
  @Get("organizations/:organizationId")
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member", "viewer"],
    description: "查看组织的基础资料。",
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
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    description: "创建新的子组织并加入组织树。",
    entity: "organization",
    entityLabel: "组织",
    label: "创建组织",
    operation: "create",
    purpose: "tenant_organization",
    purposeLabel: "工作空间组织",
    scope: "tenant",
    sortOrder: 20,
  })
  create(
    @Req() request: PrincipalRequest,
    @Body() payload: CreateOrganizationPayload,
  ) {
    const userId = request.accessPrincipal?.userId?.trim();
    if (!userId) throw new Error("Tenant principal is missing an id.");
    return this.organizationsService.create(userId, payload);
  }

  /**
   * Updates a managed organization selected by id.
   */
  @Patch("organizations/:organizationId")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    description: "更新组织的基础资料。",
    label: "更新组织资料",
    operation: "update_basic",
    sortOrder: 20,
  })
  update(
    @Param("organizationId") organizationId: string,
    @Body() payload: UpdateOrganizationPayload,
  ) {
    return this.organizationsService.update(organizationId, payload);
  }

  /**
   * Deletes a managed organization selected by id.
   */
  @Delete("organizations/:organizationId")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    description: "删除当前工作空间中的组织。",
    entity: "organization",
    entityLabel: "组织",
    isDangerous: true,
    label: "删除组织",
    operation: "delete",
    purpose: "tenant_organization",
    purposeLabel: "工作空间组织",
    scope: "tenant",
    sortOrder: 90,
  })
  delete(
    @Param("organizationId") organizationId: string,
  ) {
    return this.organizationsService.delete(organizationId);
  }

}
