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

  @Get("tenant/settings")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin", "tenant-member"],
    description: "查看当前工作空间配置项。",
    label: "查看工作空间配置",
    operation: "list",
    purpose: "tenant_config",
    purposeLabel: "工作空间配置",
    scope: "tenant",
    sortOrder: 10,
  })
  listTenantSettings(@Req() request: TenantSettingsRequest) {
    return this.settingsService.listTenantSettings(requireTenantId(request));
  }

  @Put("tenant/settings")
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin"],
    description: "更新当前工作空间配置项。",
    label: "更新工作空间配置",
    operation: "save",
    purpose: "tenant_config",
    purposeLabel: "工作空间配置",
    scope: "tenant",
    sortOrder: 20,
  })
  saveTenantSettings(
    @Req() request: TenantSettingsRequest,
    @Body() payload: SaveSettingsPayload,
  ) {
    return this.settingsService.saveTenantSettings(
      requireTenantId(request),
      payload,
    );
  }

}

type TenantSettingsRequest = {
  accessPrincipal?: { tenantId?: string | null };
};

function requireTenantId(request: TenantSettingsRequest) {
  const tenantId = request.accessPrincipal?.tenantId?.trim();
  if (!tenantId) throw new Error("Tenant context was not established by the access guard.");
  return tenantId;
}
