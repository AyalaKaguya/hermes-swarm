import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { DepartmentsService } from "./departments.service.js";

type TenantRequest = {
  accessPrincipal?: { tenantId?: string | null; userId?: string };
};

@Controller("admin/organizations/:organizationId/departments")
@AccessResource({
  entity: "department",
  entityLabel: "部门",
  entityOrder: 25,
  purpose: "organization_department",
  purposeLabel: "部门管理",
  purposeOrder: 10,
  scope: "organization",
})
export class DepartmentsController {
  constructor(private readonly departmentsService: DepartmentsService) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member", "viewer"],
    label: "查看部门",
    operation: "list",
  })
  list(@Req() request: TenantRequest, @Param("organizationId") organizationId: string) {
    return this.departmentsService.list(requireTenantId(request), organizationId);
  }

  @Post()
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    label: "创建部门",
    operation: "create",
  })
  create(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Body() payload: DepartmentPayload,
  ) {
    return this.departmentsService.create(
      requireTenantId(request),
      organizationId,
      payload,
    );
  }

  @Patch(":departmentId")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    label: "更新部门",
    operation: "update",
  })
  update(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
    @Body() payload: Partial<DepartmentPayload>,
  ) {
    return this.departmentsService.update(
      requireTenantId(request),
      organizationId,
      departmentId,
      payload,
    );
  }

  @Delete(":departmentId")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    isDangerous: true,
    label: "删除部门",
    operation: "delete",
  })
  remove(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
  ) {
    return this.departmentsService.remove(
      requireTenantId(request),
      organizationId,
      departmentId,
    );
  }

  @Get(":departmentId/members")
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member", "viewer"],
    label: "查看部门成员",
    operation: "list_members",
  })
  listMembers(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
  ) {
    return this.departmentsService.listMembers(
      requireTenantId(request),
      organizationId,
      departmentId,
    );
  }

  @Post(":departmentId/members")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    label: "添加部门成员",
    operation: "add_member",
  })
  addMember(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
    @Body() payload: DepartmentMemberPayload,
  ) {
    return this.departmentsService.addMember(
      requireTenantId(request),
      organizationId,
      departmentId,
      payload,
    );
  }

  @Delete(":departmentId/members/:memberId")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    isDangerous: true,
    label: "移除部门成员",
    operation: "remove_member",
  })
  removeMember(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
    @Param("memberId") memberId: string,
  ) {
    return this.departmentsService.removeMember(
      requireTenantId(request),
      organizationId,
      departmentId,
      memberId,
    );
  }

  @Get(":departmentId/dispatch-relations")
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member", "viewer"],
    label: "查看部门调度关系",
    operation: "list_dispatch_relations",
  })
  listDispatchRelations(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
  ) {
    return this.departmentsService.listDispatchRelations(
      requireTenantId(request),
      organizationId,
      departmentId,
    );
  }

  @Post(":departmentId/dispatch-relations")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    label: "创建部门调度关系",
    operation: "create_dispatch_relation",
  })
  createDispatchRelation(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
    @Body() payload: DepartmentDispatchPayload,
  ) {
    return this.departmentsService.createDispatchRelation(
      requireTenantId(request),
      organizationId,
      departmentId,
      payload,
    );
  }

  @Delete(":departmentId/dispatch-relations/:relationId")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    isDangerous: true,
    label: "删除部门调度关系",
    operation: "delete_dispatch_relation",
  })
  removeDispatchRelation(
    @Req() request: TenantRequest,
    @Param("organizationId") organizationId: string,
    @Param("departmentId") departmentId: string,
    @Param("relationId") relationId: string,
  ) {
    return this.departmentsService.removeDispatchRelation(
      requireTenantId(request),
      organizationId,
      departmentId,
      relationId,
    );
  }
}

export type DepartmentPayload = {
  code?: string | null;
  description?: string | null;
  name?: string;
  parentDepartmentId?: string | null;
  slug?: string;
  status?: "active" | "disabled";
};

export type DepartmentMemberPayload = {
  isDefault?: boolean;
  membershipId?: string;
};

export type DepartmentDispatchPayload = {
  isEnabled?: boolean;
  policy?: Record<string, unknown>;
  priority?: number;
  targetDepartmentId?: string;
  type?: "handoff" | "escalation" | "collaboration" | "fallback";
};

function requireTenantId(request: TenantRequest) {
  const tenantId = request.accessPrincipal?.tenantId?.trim();
  if (!tenantId) throw new Error("Tenant context was not established by the access guard.");
  return tenantId;
}
