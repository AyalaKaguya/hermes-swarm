import { BadRequestException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { SystemSetting } from "@hermes-swarm/core";
import type { SaveSettingsPayload } from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";

@Injectable()
/**
 * Persists migrated organization-level and global system settings using the
 * existing tenancy settings plus the new shared SystemSetting entity.
 */
export class SettingsService {
  constructor(
    @InjectRepository(SystemSetting)
    private readonly systemSettingRepository: Repository<SystemSetting>,
    private readonly tenancyService: TenancyService,
  ) {}

  /**
   * Lists settings scoped to the authenticated admin's current organization.
   */
  async listOrganizationSettings(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.listSettings(context);
  }

  /**
   * Saves organization settings from either key-value or array payload shapes.
   */
  async saveOrganizationSettings(
    authorization: string | undefined,
    payload: SaveSettingsPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.tenancyService.saveSettings(context, payload);
  }

  /**
   * Lists global system settings after verifying settings view permission.
   */
  async listSystemSettings(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "settings", "view");
    const settings = await this.systemSettingRepository.find({
      order: { name: "ASC" },
    });
    return settings.map(toSystemSettingDto);
  }

  /**
   * Creates or updates global system settings after settings manage permission.
   */
  async saveSystemSettings(
    authorization: string | undefined,
    payload: SaveSettingsPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.tenancyService.ensurePermission(context, "settings", "manage");
    const entries = normalizeSettingsPayload(payload);
    const saved: SystemSetting[] = [];

    for (const entry of entries) {
      let setting = await this.systemSettingRepository.findOne({
        where: { name: entry.name },
      });
      if (!setting) {
        setting = this.systemSettingRepository.create({
          name: entry.name,
          value: entry.value,
          scope: "global",
        });
      } else {
        setting.value = entry.value;
      }
      saved.push(await this.systemSettingRepository.save(setting));
    }

    return saved.map(toSystemSettingDto);
  }
}

/**
 * Projects the shared SystemSetting entity into the admin API response shape.
 */
function toSystemSettingDto(setting: SystemSetting) {
  return {
    id: setting.id,
    name: setting.name,
    scope: setting.scope,
    value: setting.value,
  };
}

/**
 * Normalizes xpert-style setting arrays and plain key-value maps.
 */
function normalizeSettingsPayload(payload: SaveSettingsPayload) {
  const entries = Array.isArray((payload as { settings?: unknown }).settings)
    ? (payload as {
        settings: Array<{
          name?: string;
          value?: string | number | boolean | null;
        }>;
      }).settings.map((item) => ({
        name: requireName(item.name),
        value: stringifySettingValue(item.value),
      }))
    : Object.entries(payload)
        .filter(([key]) => key !== "settings")
        .map(([name, value]) => ({
          name: requireName(name),
          value: stringifySettingValue(value),
        }));

  if (entries.length === 0) {
    throw new BadRequestException("设置不能为空");
  }

  return entries;
}

/**
 * Validates and trims a setting name.
 */
function requireName(value: string | undefined) {
  const text = value?.trim();
  if (!text) {
    throw new BadRequestException("设置名称不能为空");
  }
  return text;
}

/**
 * Stores primitive and structured setting values in the text-backed column.
 */
function stringifySettingValue(value: unknown) {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : JSON.stringify(value);
}
