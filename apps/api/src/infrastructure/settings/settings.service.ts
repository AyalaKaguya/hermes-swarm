import { Injectable, Logger, OnModuleInit } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { EntityManager, Repository } from "typeorm";
import {
  FEATURE_SETTING_DEFINITIONS,
  getFeatureSettingDefaultValue,
  maskSettingValue,
  mergeEffectiveOrganizationSettings,
  OrganizationSetting,
  PlatformSetting,
  PLATFORM_SETTING_DEFINITIONS,
  resolveSettingValueOptions,
  resolveSettingValueType,
  type EffectiveOrganizationSetting,
  type SettingValueOption,
} from "@hermes-swarm/core";
import type { SaveSettingsPayload } from "../../common/admin-api.types.js";
import { RedisService } from "../../common/redis/redis.service.js";
import {
  normalizeSettingEntry,
  parseSettingsPayload,
} from "./settings-value-normalizer.js";

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(PlatformSetting)
    private readonly platformSettingRepository: Repository<PlatformSetting>,
    @InjectRepository(OrganizationSetting)
    private readonly organizationSettingRepository: Repository<OrganizationSetting>,
    private readonly redisService: RedisService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultPlatformSettings().catch((error) => {
      this.logger.error(`平台默认配置初始化失败: ${String(error)}`);
    });
  }

  async listOrganizationSettingsForOrganization(
    organizationId: string,
  ): Promise<EffectiveOrganizationSetting[]> {
    const [organizationSettings, platformSettings] = await Promise.all([
      this.organizationSettingRepository.find({
        order: { name: "ASC" },
        where: { organizationId },
      }),
      this.platformSettingRepository.find({ order: { name: "ASC" } }),
    ]);

    return mergeEffectiveOrganizationSettings(
      organizationSettings,
      platformSettings,
      organizationId,
    );
  }

  async saveOrganizationSettingsForOrganization(
    organizationId: string,
    payload: SaveSettingsPayload,
  ) {
    const entries = parseSettingsPayload(payload);
    const invalidations = await this.platformSettingRepository.manager.transaction(
      async (manager) =>
        this.saveOrganizationSettingsInTransaction(
          manager,
          organizationId,
          entries,
        ),
    );

    for (const invalidation of invalidations) {
      await this.applySettingsInvalidation(invalidation);
    }

    return this.listOrganizationSettingsForOrganization(organizationId);
  }

  async listPlatformSettings() {
    const settings = await this.platformSettingRepository.find({
      order: { name: "ASC" },
    });
    return settings.map(toPlatformSettingDto);
  }

  async savePlatformSettings(payload: SaveSettingsPayload) {
    const entries = parseSettingsPayload(payload);
    const invalidations = await this.platformSettingRepository.manager.transaction(
      async (manager) => this.savePlatformSettingsInTransaction(manager, entries),
    );

    for (const invalidation of invalidations) {
      await this.applySettingsInvalidation(invalidation);
    }

    return this.listPlatformSettings();
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

  private async ensureDefaultPlatformSettings() {
    const definitions = [
      ...Object.values(PLATFORM_SETTING_DEFINITIONS),
      ...FEATURE_SETTING_DEFINITIONS.map((definition) => ({
        defaultValue: getFeatureSettingDefaultValue(definition),
        key: definition.key,
        scope: definition.scope === "system" ? "platform" : "organization",
        valueOptions:
          "valueOptions" in definition ? definition.valueOptions : undefined,
        valueType: definition.valueType,
      })),
    ];

    for (const definition of definitions) {
      const existing = await this.platformSettingRepository.findOne({
        where: { name: definition.key },
      });
      if (existing) continue;

      const valueOptions = getDefinitionValueOptions(definition);
      try {
        await this.platformSettingRepository.save(
          this.platformSettingRepository.create({
            name: definition.key,
            scope: definition.scope ?? "global",
            value: definition.defaultValue ?? null,
            valueOptions,
            valueType: definition.valueType,
          }),
        );
      } catch (error) {
        if (isUniqueConstraintError(error)) continue;
        throw error;
      }
    }
  }

  private async savePlatformSettingsInTransaction(
    manager: EntityManager,
    entries: ReturnType<typeof parseSettingsPayload>,
  ) {
    const platformSettingRepository = manager.getRepository(PlatformSetting);
    const invalidations: AppliedSettingsInvalidation[] = [];

    for (const entry of entries) {
      if (entry.value === null || entry.value === undefined) {
        await platformSettingRepository.delete({ name: entry.name });
        invalidations.push({
          cacheKey: this.platformCacheKey(entry.name),
          name: entry.name,
          scope: "platform",
          value: null,
        });
        continue;
      }

      const existing = await platformSettingRepository.findOne({
        where: { name: entry.name },
      });
      const normalized = normalizeSettingEntry(entry, [existing]);
      const setting =
        existing ??
        platformSettingRepository.create({
          name: entry.name,
          scope: "global",
        });

      setting.value = normalized.value;
      setting.valueOptions = normalized.valueOptions;
      setting.valueType = normalized.valueType;

      const persisted = await platformSettingRepository.save(setting);
      invalidations.push({
        cacheKey: this.platformCacheKey(entry.name),
        name: entry.name,
        scope: "platform",
        value: persisted.value,
      });
    }

    return invalidations;
  }

  private async saveOrganizationSettingsInTransaction(
    manager: EntityManager,
    organizationId: string,
    entries: ReturnType<typeof parseSettingsPayload>,
  ) {
    const organizationSettingRepository =
      manager.getRepository(OrganizationSetting);
    const platformSettingRepository = manager.getRepository(PlatformSetting);
    const invalidations: AppliedSettingsInvalidation[] = [];

    for (const entry of entries) {
      const [existing, platformSetting] = await Promise.all([
        organizationSettingRepository.findOne({
          where: { name: entry.name, organizationId },
        }),
        platformSettingRepository.findOne({
          where: { name: entry.name },
        }),
      ]);

      if (entry.value === null || entry.value === undefined) {
        await organizationSettingRepository.delete({
          name: entry.name,
          organizationId,
        });
        invalidations.push({
          cacheKey: this.organizationCacheKey(organizationId, entry.name),
          name: entry.name,
          organizationId,
          scope: "organization",
          value: null,
        });
        continue;
      }

      const normalized = normalizeSettingEntry(entry, [
        existing,
        platformSetting,
      ]);
      const setting =
        existing ??
        organizationSettingRepository.create({
          name: entry.name,
          organizationId,
        });

      setting.value = normalized.value;
      setting.valueOptions = normalized.valueOptions;
      setting.valueType = normalized.valueType;

      const persisted = await organizationSettingRepository.save(setting);
      invalidations.push({
        cacheKey: this.organizationCacheKey(organizationId, entry.name),
        name: entry.name,
        organizationId,
        scope: "organization",
        value: persisted.value,
      });
    }

    return invalidations;
  }

  private async applySettingsInvalidation(
    invalidation: AppliedSettingsInvalidation,
  ) {
    if (invalidation.value === null) {
      await this.deleteCache(invalidation.cacheKey);
    } else {
      await this.setCache(invalidation.cacheKey, invalidation.value);
    }

    if (invalidation.scope === "platform") {
      await this.publishSettingsInvalidation({
        name: invalidation.name,
        scope: "platform",
      });
      return;
    }

    await this.publishSettingsInvalidation({
      name: invalidation.name,
      organizationId: invalidation.organizationId,
      scope: "organization",
    });
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
      this.logger.warn(
        `Redis settings cache invalidation failed: ${String(error)}`,
      );
    }
  }

  private async publishSettingsInvalidation(event: SettingsInvalidationEvent) {
    const client = await this.getRedisClient();
    if (!client) return;

    try {
      await client.publish(
        SETTINGS_INVALIDATION_CHANNEL,
        JSON.stringify({
          ...event,
          at: new Date().toISOString(),
        }),
      );
    } catch (error) {
      this.logger.warn(
        `Redis settings invalidation publish failed: ${String(error)}`,
      );
    }
  }

  private async getRedisClient() {
    try {
      return await this.redisService.getClient();
    } catch (error) {
      this.logger.warn(`Redis settings cache unavailable: ${String(error)}`);
      return null;
    }
  }
}

const SETTINGS_INVALIDATION_CHANNEL = "settings:invalidate";

type SettingsInvalidationEvent =
  | {
      name: string;
      scope: "platform";
    }
  | {
      name: string;
      organizationId: string;
      scope: "organization";
    };

type AppliedSettingsInvalidation =
  | {
      cacheKey: string;
      name: string;
      scope: "platform";
      value: string | null;
    }
  | {
      cacheKey: string;
      name: string;
      organizationId: string;
      scope: "organization";
      value: string | null;
    };

function getDefinitionValueOptions(definition: unknown) {
  const valueOptions =
    definition && typeof definition === "object" && "valueOptions" in definition
      ? (definition as { valueOptions?: unknown }).valueOptions
      : null;
  return Array.isArray(valueOptions)
    ? ([...valueOptions] as SettingValueOption[])
    : null;
}

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

function isUniqueConstraintError(error: unknown) {
  const typed = error as { code?: string; driverError?: { code?: string } };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}
