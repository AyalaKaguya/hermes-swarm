import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import type { SaveSettingsPayload } from "../common/admin-api.types.js";
import {
  PermissionOperation,
  PermissionResource,
} from "@hermes-swarm/rbac";
import { SettingsService } from "./settings.service.js";

@Controller("admin")
@PermissionResource({
  entity: "setting",
  entityLabel: "配置",
  entityOrder: 40,
  purpose: "platform_config",
  purposeLabel: "平台配置",
  purposeOrder: 10,
  scope: "platform",
})
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("platform/settings")
  @PermissionOperation({
    description: "查看平台配置项。",
    label: "查看平台配置",
    operation: "list",
    sortOrder: 10,
  })
  listPlatformSettings() {
    return this.settingsService.listPlatformSettings();
  }

  @Put("platform/settings")
  @PermissionOperation({
    description: "更新平台配置项。",
    isDangerous: true,
    label: "更新平台配置",
    operation: "save",
    sortOrder: 20,
  })
  savePlatformSettings(@Body() payload: SaveSettingsPayload) {
    return this.settingsService.savePlatformSettings(payload);
  }

  @Get("organizations/:organizationId/settings")
  @PermissionOperation({
    description: "查看当前组织配置项。",
    label: "查看组织配置",
    operation: "list",
    purpose: "organization_config",
    purposeLabel: "组织配置",
    scope: "organization",
    sortOrder: 10,
  })
  listOrganizationSettings(
    @Param("organizationId") organizationId: string,
  ) {
    return this.settingsService.listOrganizationSettingsForOrganization(
      organizationId,
    );
  }

  @Put("organizations/:organizationId/settings")
  @PermissionOperation({
    description: "更新当前组织配置项。",
    label: "更新组织配置",
    operation: "save",
    purpose: "organization_config",
    purposeLabel: "组织配置",
    scope: "organization",
    sortOrder: 20,
  })
  saveOrganizationSettings(
    @Param("organizationId") organizationId: string,
    @Body() payload: SaveSettingsPayload,
  ) {
    return this.settingsService.saveOrganizationSettingsForOrganization(
      organizationId,
      payload,
    );
  }
}
