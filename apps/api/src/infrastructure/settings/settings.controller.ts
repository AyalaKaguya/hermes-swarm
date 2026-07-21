import { Body, Controller, Get, Inject, Put, Req } from "@nestjs/common";
import type { SaveSettingsPayload } from "../../common/admin-api.types.js";
import {
  AccessOperation,
  AccessResource,
} from "@hermes-swarm/rbac";
import { SettingsService } from "./settings.service.js";

@Controller("admin")
@AccessResource({
  entity: "setting",
  entityLabel: "配置",
  entityOrder: 40,
  purpose: "platform_config",
  purposeLabel: "平台配置",
  purposeOrder: 10,
  scope: "platform",
})
export class SettingsController {
  constructor(
    @Inject(SettingsService)
    private readonly settingsService: SettingsService,
  ) {}

  @Get("platform/settings")
  @AccessOperation({
    description: "查看平台配置项。",
    label: "查看平台配置",
    operation: "list",
    sortOrder: 10,
  })
  listPlatformSettings() {
    return this.settingsService.listPlatformSettings();
  }

  @Put("platform/settings")
  @AccessOperation({
    description: "更新平台配置项。",
    isDangerous: true,
    label: "更新平台配置",
    operation: "save",
    sortOrder: 20,
  })
  savePlatformSettings(@Body() payload: SaveSettingsPayload) {
    return this.settingsService.savePlatformSettings(payload);
  }

  @Get("workspace/settings")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    description: "查看当前工作空间配置项。",
    label: "查看工作空间配置",
    operation: "list",
    purpose: "workspace_config",
    purposeLabel: "工作空间配置",
    scope: "workspace",
    sortOrder: 10,
  })
  listWorkspaceSettings(@Req() request: WorkspaceSettingsRequest) {
    return this.settingsService.listWorkspaceSettings(requireWorkspaceId(request));
  }

  @Put("workspace/settings")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    description: "更新当前工作空间配置项。",
    label: "更新工作空间配置",
    operation: "save",
    purpose: "workspace_config",
    purposeLabel: "工作空间配置",
    scope: "workspace",
    sortOrder: 20,
  })
  saveWorkspaceSettings(
    @Req() request: WorkspaceSettingsRequest,
    @Body() payload: SaveSettingsPayload,
  ) {
    return this.settingsService.saveWorkspaceSettings(
      requireWorkspaceId(request),
      payload,
    );
  }

}

type WorkspaceSettingsRequest = {
  accessPrincipal?: { workspaceId?: string | null };
};

function requireWorkspaceId(request: WorkspaceSettingsRequest) {
  const workspaceId = request.accessPrincipal?.workspaceId?.trim();
  if (!workspaceId) throw new Error("Workspace context was not established by the access guard.");
  return workspaceId;
}
