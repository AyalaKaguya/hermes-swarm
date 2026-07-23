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
import { WorkspaceApplicationsService } from "./workspace-applications.service.js";
import { WorkspacesService } from "./workspaces.service.js";
import type {
  UpdateWorkspacePayload,
  UpdateWorkspaceStatusPayload,
  WorkspaceApplicationPayload,
  WorkspaceApplicationReviewPayload,
  WorkspaceRolePayload,
  WorkspaceRolePermissionsPayload,
} from "./workspace.types.js";
export type {
  UpdateWorkspacePayload,
  UpdateWorkspaceStatusPayload,
  WorkspaceApplicationPayload,
  WorkspaceApplicationReviewPayload,
  WorkspaceRolePayload,
  WorkspaceRolePermissionsPayload,
} from "./workspace.types.js";

export type PrincipalRequest = {
  accessPrincipal?: {
    principalType?: "integration" | "platform" | "workspace";
    workspaceId?: string | null;
    userId?: string;
  };
};

@Controller("admin")
export class WorkspaceApplicationsController {
  constructor(
    private readonly workspaceApplicationsService: WorkspaceApplicationsService,
    private readonly workspacesService: WorkspacesService,
  ) {}

  @Post("workspace-applications")
  @PublicAccess({ reason: "A prospective workspace owner can submit an application before login." })
  apply(
    @Body() payload: WorkspaceApplicationPayload,
    @Headers("accept-language") acceptLanguage?: string,
  ) {
    return this.workspaceApplicationsService.apply({
      ...payload,
      preferredLanguage: payload?.preferredLanguage ?? acceptLanguage,
    });
  }

  @Post("workspace-applications/:applicationId/verify")
  @PublicAccess({ reason: "Email verification completes the public workspace application." })
  verify(
    @Param("applicationId") applicationId: string,
    @Body() payload: { token?: string },
  ) {
    return this.workspaceApplicationsService.verifyApplication(
      applicationId,
      payload?.token,
    );
  }

  @Post("workspace-applications/:applicationId/cancel")
  @PublicAccess({ reason: "The applicant can cancel an unprocessed workspace application with its private cancellation token." })
  cancel(
    @Param("applicationId") applicationId: string,
    @Body() payload: { token?: string },
  ) {
    return this.workspaceApplicationsService.cancelApplication(
      applicationId,
      payload?.token,
    );
  }

  @Post("workspace-applications/activate-owner")
  @PublicAccess({ reason: "The approved owner activation token authorizes initial workspace membership creation." })
  activateOwner(
    @Body() payload: {
      displayName?: string;
      password?: string;
      token?: string;
    },
  ) {
    return this.workspaceApplicationsService.activateWorkspaceOwner(payload);
  }

  @Get("platform/workspace-applications")
  @AccessResource({
    entity: "workspace_application",
    entityLabel: "工作空间申请",
    purpose: "workspace_governance",
    purposeLabel: "工作空间治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "查看工作空间申请",
    operation: "list",
  })
  listApplications() {
    return this.workspaceApplicationsService.listApplications();
  }

  @Get("platform/workspaces")
  @AccessResource({
    entity: "workspace",
    entityLabel: "工作空间",
    purpose: "workspace_governance",
    purposeLabel: "工作空间治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "查看工作空间目录",
    operation: "list",
  })
  listWorkspaces() {
    return this.workspacesService.listWorkspaces();
  }

  @Patch("platform/workspaces/:workspaceId/status")
  @AccessResource({
    entity: "workspace",
    entityLabel: "工作空间",
    purpose: "workspace_governance",
    purposeLabel: "工作空间治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    isDangerous: true,
    label: "更新工作空间状态",
    operation: "update_status",
  })
  updateWorkspaceStatus(
    @Param("workspaceId") workspaceId: string,
    @Body() payload: UpdateWorkspaceStatusPayload,
  ) {
    return this.workspacesService.updateWorkspaceStatus(workspaceId, payload?.status);
  }

  @Post("platform/workspace-applications/:applicationId/approve")
  @AccessResource({
    entity: "workspace_application",
    entityLabel: "工作空间申请",
    purpose: "workspace_governance",
    purposeLabel: "工作空间治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    isDangerous: true,
    label: "批准工作空间申请",
    operation: "approve",
  })
  approve(
    @Req() request: PrincipalRequest,
    @Param("applicationId") applicationId: string,
    @Body() payload: WorkspaceApplicationReviewPayload,
  ) {
    return this.workspaceApplicationsService.approveApplication(
      requirePlatformAccountId(request),
      applicationId,
      payload,
    );
  }

  @Post("platform/workspace-applications/:applicationId/reject")
  @AccessResource({
    entity: "workspace_application",
    entityLabel: "工作空间申请",
    purpose: "workspace_governance",
    purposeLabel: "工作空间治理",
    scope: "platform",
  })
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    isDangerous: true,
    label: "拒绝工作空间申请",
    operation: "reject",
  })
  reject(
    @Req() request: PrincipalRequest,
    @Param("applicationId") applicationId: string,
    @Body() payload: WorkspaceApplicationReviewPayload,
  ) {
    return this.workspaceApplicationsService.rejectApplication(
      requirePlatformAccountId(request),
      applicationId,
      payload,
    );
  }
}

@Controller("admin/workspace")
@AccessResource({
  entity: "workspace",
  entityLabel: "工作空间",
  purpose: "workspace_profile",
  purposeLabel: "工作空间资料",
  scope: "workspace",
})
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    label: "查看工作空间资料",
    operation: "view",
  })
  get(@Req() request: PrincipalRequest) {
    return this.workspacesService.get(requireWorkspaceId(request));
  }

  @Get("console-capability")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "允许进入当前工作空间控制台。",
    entity: "workspace",
    entityLabel: "工作空间",
    label: "进入工作空间控制台",
    operation: "access",
    purpose: "console",
    purposeLabel: "控制台访问",
    scope: "workspace",
  })
  consoleCapability() {
    return { allowed: true };
  }

  @Patch()
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    label: "更新工作空间资料",
    operation: "update",
  })
  update(@Req() request: PrincipalRequest, @Body() payload: UpdateWorkspacePayload) {
    return this.workspacesService.update(requireWorkspaceId(request), payload);
  }

}

function requireWorkspaceId(request: PrincipalRequest) {
  const workspaceId = request.accessPrincipal?.workspaceId?.trim();
  if (!workspaceId) throw new Error("Workspace context was not established by the access guard.");
  return workspaceId;
}

function requirePlatformAccountId(request: PrincipalRequest) {
  if (request.accessPrincipal?.principalType !== "platform") {
    throw new Error("Platform principal was not established by the access guard.");
  }
  const userId = request.accessPrincipal.userId?.trim();
  if (!userId) throw new Error("Platform principal is missing an id.");
  return userId;
}
