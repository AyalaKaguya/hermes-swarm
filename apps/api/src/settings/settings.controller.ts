import { Body, Controller, Get, Headers, Put } from "@nestjs/common";
import type { SaveSettingsPayload } from "../tenancy/tenancy.types.js";
import { SettingsService } from "./settings.service.js";

@Controller("admin")
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get("settings")
  listOrganizationSettings(@Headers("authorization") authorization?: string) {
    return this.settingsService.listOrganizationSettings(authorization);
  }

  @Put("settings")
  saveOrganizationSettings(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: SaveSettingsPayload,
  ) {
    return this.settingsService.saveOrganizationSettings(authorization, payload);
  }

  @Get("system-settings")
  listSystemSettings(@Headers("authorization") authorization?: string) {
    return this.settingsService.listSystemSettings(authorization);
  }

  @Put("system-settings")
  saveSystemSettings(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: SaveSettingsPayload,
  ) {
    return this.settingsService.saveSystemSettings(authorization, payload);
  }
}
