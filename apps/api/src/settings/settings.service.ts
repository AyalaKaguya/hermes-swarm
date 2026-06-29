import { ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import { createClient } from "redis";
import {
  maskSettingValue,
  OrganizationSetting,
  PlatformSetting,
  resolveSettingValueOptions,
  resolveSettingValueType,
} from "@hermes-swarm/core";
import { getRedisUrl } from "@hermes-swarm/core/config/redis";
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
  private readonly logger = new Logger(SettingsService.name);
  private redisClientPromise: Promise<ReturnType<typeof createClient> | null> | null =
    null;

  constructor(
    @InjectRepository(PlatformSetting)
    private readonly platformSettingRepository: Repository<PlatformSetting>,
    @InjectRepository(OrganizationSetting)
    private readonly organizationSettingRepository: Repository<OrganizationSetting>,
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
    const entries = parseSettingsPayload(payload);
    const result = await this.tenancyService.saveSettings(context, payload);
    await Promise.all(
      entries.map((entry) =>
        this.deleteCache(this.organizationCacheKey(context.organizationId, entry.name)),
      ),
    );
    return result;
  }

  /**
   * Lists global system settings after verifying settings view permission.
   */
  async listSystemSettings(authorization: string | undefined) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    this.ensureSystemSettingsPermission(context, "view");
    const settings = await this.platformSettingRepository.find({
      order: { name: "ASC" },
    });
    return settings.map(toPlatformSettingDto);
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
    const saved: PlatformSetting[] = [];

    for (const entry of entries) {
      if (entry.value === null || entry.value === undefined) {
        await this.platformSettingRepository.delete({ name: entry.name });
        await this.deleteCache(this.platformCacheKey(entry.name));
        continue;
      }

      let setting = await this.platformSettingRepository.findOne({
        where: { name: entry.name },
      });
      const normalized = normalizeSettingEntry(entry, [setting]);
      if (!setting) {
        setting = this.platformSettingRepository.create({
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
      const persisted = await this.platformSettingRepository.save(setting);
      await this.setCache(this.platformCacheKey(entry.name), persisted.value);
      saved.push(persisted);
    }

    return saved.map(toPlatformSettingDto);
  }

  async getPlatformValue(name: string, fallback: string | null = null) {
    const cacheKey = this.platformCacheKey(name);
    const cached = await this.getCache(cacheKey);
    if (cached !== null) return cached;

    const setting = await this.platformSettingRepository.findOne({
      where: { name },
    });
    const value = setting?.value ?? fallback;
    await this.setCache(cacheKey, value);
    return value;
  }

  async getOrganizationValue(
    organizationId: string,
    name: string,
    fallback: string | null = null,
  ) {
    const cacheKey = this.organizationCacheKey(organizationId, name);
    const cached = await this.getCache(cacheKey);
    if (cached !== null) return cached;

    const setting = await this.organizationSettingRepository.findOne({
      where: { name, organizationId },
    });
    if (setting?.value !== null && setting?.value !== undefined) {
      await this.setCache(cacheKey, setting.value);
      return setting.value;
    }

    return this.getPlatformValue(name, fallback);
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

  private platformCacheKey(name: string) {
    return `settings:platform:${name}`;
  }

  private organizationCacheKey(organizationId: string, name: string) {
    return `settings:organization:${organizationId}:${name}`;
  }

  private async getCache(key: string) {
    const client = await this.getRedisClient();
    if (!client) return null;

    try {
      return await client.get(key);
    } catch (error) {
      this.logger.warn(`Redis settings cache read failed: ${String(error)}`);
      return null;
    }
  }

  private async setCache(key: string, value: string | null) {
    const client = await this.getRedisClient();
    if (!client) return;

    try {
      if (value === null) {
        await client.del(key);
        return;
      }
      await client.set(key, value);
    } catch (error) {
      this.logger.warn(`Redis settings cache write failed: ${String(error)}`);
    }
  }

  private async deleteCache(key: string) {
    const client = await this.getRedisClient();
    if (!client) return;

    try {
      await client.del(key);
    } catch (error) {
      this.logger.warn(`Redis settings cache invalidation failed: ${String(error)}`);
    }
  }

  private getRedisClient() {
    if (!this.redisClientPromise) {
      this.redisClientPromise = this.connectRedis();
    }
    return this.redisClientPromise;
  }

  private async connectRedis() {
    try {
      const client = createClient({ url: getRedisUrl() });
      client.on("error", (error) => {
        this.logger.warn(`Redis settings cache connection error: ${String(error)}`);
      });
      await client.connect();
      return client;
    } catch (error) {
      this.logger.warn(`Redis settings cache unavailable: ${String(error)}`);
      return null;
    }
  }
}

/**
 * Projects the shared PlatformSetting entity into the admin API response shape.
 */
function toPlatformSettingDto(setting: PlatformSetting) {
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
