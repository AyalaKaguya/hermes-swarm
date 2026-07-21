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
import { WorkspacesService } from "./workspaces.service.js";
import type {
  PrincipalRequest,
  WorkspaceRolePayload,
  WorkspaceRolePermissionsPayload,
} from "./workspaces.controller.js";

@Controller("admin/workspace/roles")
@AccessResource({
  entity: "role",
  entityLabel: "角色",
  purpose: "workspace_role",
  purposeLabel: "角色与权限",
  scope: "workspace",
})
export class RolesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    label: "查看角色",
    operation: "list",
  })
  list(@Req() request: PrincipalRequest) {
    return this.workspacesService.listWorkspaceRoles(requireWorkspaceId(request));
  }

  @Post()
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    label: "创建角色",
    operation: "create",
  })
  create(@Req() request: PrincipalRequest, @Body() payload: WorkspaceRolePayload) {
    return this.workspacesService.createWorkspaceRole(requireWorkspaceId(request), payload);
  }

  @Patch(":roleId")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    label: "更新角色",
    operation: "update",
  })
  update(
    @Req() request: PrincipalRequest,
    @Param("roleId") roleId: string,
    @Body() payload: Partial<WorkspaceRolePayload>,
  ) {
    return this.workspacesService.updateWorkspaceRole(requireWorkspaceId(request), roleId, payload);
  }

  @Put(":roleId/permissions")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    isDangerous: true,
    label: "配置角色权限",
    operation: "replace_permissions",
  })
  replacePermissions(
    @Req() request: PrincipalRequest,
    @Param("roleId") roleId: string,
    @Body() payload: WorkspaceRolePermissionsPayload,
  ) {
    return this.workspacesService.replaceWorkspaceRolePermissions(
      requireWorkspaceId(request),
      roleId,
      payload,
      request.accessPrincipal?.userId,
    );
  }

  @Delete(":roleId")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    isDangerous: true,
    label: "删除角色",
    operation: "delete",
  })
  remove(@Req() request: PrincipalRequest, @Param("roleId") roleId: string) {
    return this.workspacesService.deleteWorkspaceRole(requireWorkspaceId(request), roleId);
  }
}

function requireWorkspaceId(request: PrincipalRequest) {
  const workspaceId = request.accessPrincipal?.workspaceId?.trim();
  if (!workspaceId) throw new Error("Workspace context was not established by the access guard.");
  return workspaceId;
}
