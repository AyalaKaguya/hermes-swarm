import { Body, Controller, Get, Headers, Put } from "@nestjs/common";
import type { SaveSettingsPayload } from "../tenancy/tenancy.types.js";
import { SettingsService } from "./settings.service.js";

@Controller("admin")
/**
 * Exposes organization and global settings endpoints under `/api/admin`.
 */
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  /**
   * Returns settings for the current organization.
   */
  @Get("settings")
  listOrganizationSettings(@Headers("authorization") authorization?: string) {
    return this.settingsService.listOrganizationSettings(authorization);
  }

  /**
   * Saves settings for the current organization.
   */
  @Put("settings")
  saveOrganizationSettings(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: SaveSettingsPayload,
  ) {
    return this.settingsService.saveOrganizationSettings(authorization, payload);
  }

  /**
   * Returns global system settings shared across organizations.
   */
  @Get("system-settings")
  listSystemSettings(@Headers("authorization") authorization?: string) {
    return this.settingsService.listSystemSettings(authorization);
  }

  /**
   * Saves global system settings shared across organizations.
   */
  @Put("system-settings")
  saveSystemSettings(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: SaveSettingsPayload,
  ) {
    return this.settingsService.saveSystemSettings(authorization, payload);
  }
}
