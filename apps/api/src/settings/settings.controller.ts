import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import type { SaveSettingsPayload } from "../tenancy/tenancy.types.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { SettingsService } from "./settings.service.js";

@Controller("admin")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("platform/settings")
  @RequirePermission({ action: "read", entity: "setting", scope: "platform" })
  listPlatformSettings() {
    return this.settingsService.listPlatformSettings();
  }

  @Put("platform/settings")
  @RequirePermission({ action: "update", entity: "setting", scope: "platform" })
  savePlatformSettings(@Body() payload: SaveSettingsPayload) {
    return this.settingsService.savePlatformSettings(payload);
  }

  @Get("organizations/:organizationId/settings")
  @RequirePermission({
    action: "read",
    entity: "setting",
    scope: "organization",
  })
  listOrganizationSettings(
    @Param("organizationId") organizationId: string,
  ) {
    return this.settingsService.listOrganizationSettingsForOrganization(
      organizationId,
    );
  }

  @Put("organizations/:organizationId/settings")
  @RequirePermission({
    action: "update",
    entity: "setting",
    scope: "organization",
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
