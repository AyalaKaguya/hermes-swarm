import { ForbiddenException, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  maskSettingValue,
  resolveSettingValueOptions,
  resolveSettingValueType,
  SystemSetting,
} from "@hermes-swarm/core";
import type { SaveSettingsPayload } from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import {
  normalizeSettingEntry,
  parseSettingsPayload,
} from "./settings-value-normalizer.js";

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
    this.ensureSystemSettingsPermission(context, "view");
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
    this.ensureSystemSettingsPermission(context, "manage");
    const entries = parseSettingsPayload(payload);
    const saved: SystemSetting[] = [];

    for (const entry of entries) {
      if (entry.value === null || entry.value === undefined) {
        await this.systemSettingRepository.delete({ name: entry.name });
        continue;
      }

      let setting = await this.systemSettingRepository.findOne({
        where: { name: entry.name },
      });
      const normalized = normalizeSettingEntry(entry, [setting]);
      if (!setting) {
        setting = this.systemSettingRepository.create({
          name: entry.name,
          scope: "global",
          value: normalized.value,
          valueOptions: normalized.valueOptions,
          valueType: normalized.valueType,
        });
      } else {
        setting.value = normalized.value;
        setting.valueOptions = normalized.valueOptions;
        setting.valueType = normalized.valueType;
      }
      saved.push(await this.systemSettingRepository.save(setting));
    }

    return saved.map(toSystemSettingDto);
  }

  private ensureSystemSettingsPermission(
    context: Awaited<ReturnType<TenancyService["requireAuthContext"]>>,
    action: "manage" | "view",
  ) {
    try {
      this.tenancyService.ensurePlatformScope(context, "tenant", action);
    } catch {
      throw new ForbiddenException("只有平台管理员可以访问平台设置");
    }
  }
}

/**
 * Projects the shared SystemSetting entity into the admin API response shape.
 */
function toSystemSettingDto(setting: SystemSetting) {
  const valueType = resolveSettingValueType(setting.name, setting.valueType);
  const valueOptions = resolveSettingValueOptions(
    setting.name,
    setting.valueOptions,
  );
  return {
    id: setting.id,
    name: setting.name,
    scope: setting.scope,
    value: maskSettingValue(setting.value, valueType),
    valueOptions,
    valueType,
  };
}
