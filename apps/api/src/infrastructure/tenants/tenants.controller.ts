import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { AccessOperation, AccessResource, PublicAccess } from "@hermes-swarm/rbac";
import { TenantsService } from "./tenants.service.js";

export type PrincipalRequest = {
  accessPrincipal?: {
    principalType?: "integration" | "platform" | "tenant";
    tenantId?: string | null;
    userId?: string;
  };
};

@Controller("admin")
export class TenantApplicationsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post("tenant-applications")
  @PublicAccess({ reason: "A prospective tenant owner can submit an application before login." })
  apply(
    @Body() payload: TenantApplicationPayload,
    @Headers("accept-language") acceptLanguage?: string,
  ) {
    return this.tenantsService.apply({
      ...payload,
      preferredLanguage: payload?.preferredLanguage ?? acceptLanguage,
    });
  }

  @Post("tenant-applications/:applicationId/verify")
  @PublicAccess({ reason: "Email verification completes the public tenant application." })
  verify(
    @Param("applicationId") applicationId: string,
    @Body() payload: { token?: string },
  ) {
    return this.tenantsService.verifyApplication(applicationId, payload?.token);
  }

  @Post("tenant-applications/:applicationId/cancel")
  @PublicAccess({ reason: "The applicant can cancel an unprocessed tenant application with its private cancellation token." })
  cancel(
    @Param("applicationId") applicationId: string,
    @Body() payload: { token?: string },
  ) {
    return this.tenantsService.cancelApplication(applicationId, payload?.token);
  }

  @Get("platform/tenant-applications")
  @AccessResource({
    entity: "tenant_application",
    entityLabel: "租户申请",
    purpose: "tenant_governance",
    purposeLabel: "租户治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "查看租户申请",
    operation: "list",
  })
  listApplications() {
    return this.tenantsService.listApplications();
  }

  @Get("platform/tenants")
  @AccessResource({
    entity: "tenant",
    entityLabel: "租户",
    purpose: "tenant_governance",
    purposeLabel: "租户治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "查看租户目录",
    operation: "list",
  })
  listTenants() {
    return this.tenantsService.listTenants();
  }

  @Patch("platform/tenants/:tenantId/status")
  @AccessResource({
    entity: "tenant",
    entityLabel: "租户",
    purpose: "tenant_governance",
    purposeLabel: "租户治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    isDangerous: true,
    label: "更新租户状态",
    operation: "update_status",
  })
  updateTenantStatus(
    @Param("tenantId") tenantId: string,
    @Body() payload: UpdateTenantStatusPayload,
  ) {
    return this.tenantsService.updateTenantStatus(tenantId, payload?.status);
  }

  @Post("platform/tenant-applications/:applicationId/approve")
  @AccessResource({
    entity: "tenant_application",
    entityLabel: "租户申请",
    purpose: "tenant_governance",
    purposeLabel: "租户治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    isDangerous: true,
    label: "批准租户申请",
    operation: "approve",
  })
  approve(
    @Req() request: PrincipalRequest,
    @Param("applicationId") applicationId: string,
    @Body() payload: TenantApplicationReviewPayload,
  ) {
    return this.tenantsService.approveApplication(
      requirePlatformUserId(request),
      applicationId,
      payload,
    );
  }

  @Post("platform/tenant-applications/:applicationId/reject")
  @AccessResource({
    entity: "tenant_application",
    entityLabel: "租户申请",
    purpose: "tenant_governance",
    purposeLabel: "租户治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    isDangerous: true,
    label: "拒绝租户申请",
    operation: "reject",
  })
  reject(
    @Req() request: PrincipalRequest,
    @Param("applicationId") applicationId: string,
    @Body() payload: TenantApplicationReviewPayload,
  ) {
    return this.tenantsService.rejectApplication(
      requirePlatformUserId(request),
      applicationId,
      payload,
    );
  }
}

@Controller("admin/tenant")
@AccessResource({
  entity: "tenant",
  entityLabel: "工作空间",
  purpose: "tenant_profile",
  purposeLabel: "工作空间资料",
  scope: "tenant",
})
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin", "tenant-member"],
    label: "查看工作空间资料",
    operation: "view",
  })
  get(@Req() request: PrincipalRequest) {
    return this.tenantsService.get(requireTenantId(request));
  }

  @Get("console-capability")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    description: "允许进入全部组织工作空间控制台。",
    entity: "workspace",
    entityLabel: "工作空间",
    label: "进入工作空间控制台",
    operation: "access",
    purpose: "console",
    purposeLabel: "控制台访问",
    scope: "tenant",
  })
  consoleCapability() {
    return { allowed: true };
  }

  @Patch()
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    label: "更新工作空间资料",
    operation: "update",
  })
  update(@Req() request: PrincipalRequest, @Body() payload: UpdateTenantPayload) {
    return this.tenantsService.update(requireTenantId(request), payload);
  }

  @Post("onboarding/root-organization")
  @AccessOperation({
    defaultRoles: ["tenant-owner"],
    label: "创建根组织",
    operation: "create_root_organization",
  })
  createRootOrganization(
    @Req() request: PrincipalRequest,
    @Body() payload: RootOrganizationPayload,
  ) {
    return this.tenantsService.createRootOrganization(
      requireTenantId(request),
      requireTenantUserId(request),
      payload,
    );
  }

}

export type TenantApplicationPayload = {
  ownerDisplayName?: string;
  ownerEmail?: string;
  preferredLanguage?: string;
  requestedName?: string;
  requestedSlug?: string;
  requestedSubdomain?: string | null;
};

export type TenantApplicationReviewPayload = {
  note?: string | null;
};

export type RootOrganizationPayload = { name?: string; slug?: string };

export type UpdateTenantPayload = {
  name?: string;
};

export type UpdateTenantStatusPayload = {
  status?: "active" | "archived" | "suspended";
};

export type TenantRolePayload = {
  color?: string | null;
  description?: string | null;
  displayName?: string;
  name?: string;
};

export type TenantRolePermissionsPayload = {
  permissions?: Array<{ enabled?: boolean; permission?: string }>;
};

function requireTenantId(request: PrincipalRequest) {
  const tenantId = request.accessPrincipal?.tenantId?.trim();
  if (!tenantId) throw new Error("Tenant context was not established by the access guard.");
  return tenantId;
}

function requirePlatformUserId(request: PrincipalRequest) {
  if (request.accessPrincipal?.principalType !== "platform") {
    throw new Error("Platform principal was not established by the access guard.");
  }
  const userId = request.accessPrincipal.userId?.trim();
  if (!userId) throw new Error("Platform principal is missing an id.");
  return userId;
}

function requireTenantUserId(request: PrincipalRequest) {
  if (request.accessPrincipal?.principalType !== "tenant") {
    throw new Error("Tenant principal was not established by the access guard.");
  }
  const userId = request.accessPrincipal.userId?.trim();
  if (!userId) throw new Error("Tenant principal is missing an id.");
  return userId;
}
