import {
  BadRequestException,
  Injectable,
  Logger,
  OnModuleInit,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { ConfigService } from "@nestjs/config";
import {
  FEATURE_SETTING_DEFINITIONS,
  PLATFORM_SETTING_DEFINITIONS,
  SECRET_SETTING_MASK,
  PlatformSetting,
  TenantSetting,
  getFeatureSettingDefaultValue,
  getSettingDefinitionByKey,
  maskSettingValue,
  mergeEffectiveTenantSettings,
  resolveRuntimePreferences,
  resolveSettingValueOptions,
  resolveSettingValueType,
  type RuntimePreferenceUser,
  type SettingValueOption,
  type SettingValueType,
} from "@hermes-swarm/core";
import type { EntityManager, Repository } from "typeorm";
import type { SaveSettingsPayload } from "../../common/admin-api.types.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import { RedisService } from "../../common/redis/redis.service.js";
import {
  normalizeSettingEntry,
  parseSettingsPayload,
} from "./settings-value-normalizer.js";
import {
  decryptSettingSecret,
  encryptSettingSecret,
  isEncryptedSettingSecret,
} from "./settings-secret-codec.js";

const SECRET_CACHE_PREFIX = "setting-secret-cache:v1:";

@Injectable()
export class SettingsService implements OnModuleInit {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    @InjectRepository(PlatformSetting, PLATFORM_DATA_SOURCE)
    private readonly platformSettingRepository: Repository<PlatformSetting>,
    private readonly redisService: RedisService,
    @Optional()
    @InjectRepository(TenantSetting)
    private readonly tenantSettingRepository?: Repository<TenantSetting>,
    @Optional()
    private readonly tenantContext?: TenantContextService,
    @Optional()
    private readonly configService?: ConfigService,
  ) {}

  async onModuleInit() {
    await this.ensureDefaultPlatformSettings().catch((error) => {
      this.logger.error(`平台默认配置初始化失败: ${String(error)}`);
    });
  }

  async listTenantSettings(tenantId: string) {
    const [tenantSettings, platformSettings] = await Promise.all([
      this.findTenantSettings(tenantId),
      this.platformSettingRepository.find({ order: { name: "ASC" } }),
    ]);
    return mergeEffectiveTenantSettings(
      tenantSettings,
      platformSettings.filter(isTenantOverridableSetting),
      tenantId,
    );
  }

  async saveTenantSettings(tenantId: string, payload: SaveSettingsPayload) {
    const entries = parseSettingsPayload(payload);
    const platformSettings = await this.platformSettingRepository.find();
    const invalidations = await this.runTenantTransaction((manager) =>
      this.saveTenantSettingsInTransaction(manager, tenantId, entries, platformSettings),
    );
    for (const invalidation of invalidations) await this.applySettingsInvalidation(invalidation);
    return this.listTenantSettings(tenantId);
  }

  async listPlatformSettings() {
    return (
      await this.platformSettingRepository.find({ order: { name: "ASC" } })
    ).map(toPlatformSettingDto);
  }

  async savePlatformSettings(payload: SaveSettingsPayload) {
    const entries = parseSettingsPayload(payload);
    const invalidations = await this.platformSettingRepository.manager.transaction(
      (manager) => this.savePlatformSettingsInTransaction(manager, entries),
    );
    for (const invalidation of invalidations) await this.applySettingsInvalidation(invalidation);
    return this.listPlatformSettings();
  }

  async getPlatformValue(name: string, fallback: string | null = null) {
    const cacheKey = this.platformCacheKey(name);
    const cached = await this.getCache(cacheKey);
    if (cached !== null) return this.decodeCachedSettingValue(cached);
    const setting = await this.platformSettingRepository.findOne({ where: { name } });
    const value = setting
      ? this.decodePersistedSettingValue(
          setting.name,
          setting.value,
          setting.valueType,
        )
      : fallback;
    await this.setCache(
      cacheKey,
      setting
        ? this.encodeCachedSettingValue(setting.value, setting.valueType)
        : value,
    );
    return value;
  }

  async getTenantValue(tenantId: string, name: string, fallback: string | null = null) {
    const cacheKey = this.tenantCacheKey(tenantId, name);
    const cached = await this.getCache(cacheKey);
    if (cached !== null) return this.decodeCachedSettingValue(cached);
    const setting = await this.tenantSettingRepository?.findOne({ where: { name, tenantId } });
    if (setting?.value !== null && setting?.value !== undefined) {
      const value = this.decodePersistedSettingValue(
        setting.name,
        setting.value,
        setting.valueType,
      );
      await this.setCache(
        cacheKey,
        this.encodeCachedSettingValue(setting.value, setting.valueType),
      );
      return value;
    }
    return this.getPlatformValue(name, fallback);
  }

  async resolveTenantRuntimePreferences(
    tenantId: string,
    user: RuntimePreferenceUser | null | undefined,
  ) {
    return resolveRuntimePreferences(user, await this.listTenantSettings(tenantId));
  }

  async resolvePlatformRuntimePreferences(
    user: RuntimePreferenceUser | null | undefined,
  ) {
    const settings = await this.listPlatformSettings();
    return resolveRuntimePreferences(
      user,
      settings.map((setting) => ({ ...setting, scope: "platform" })),
    );
  }

  private async ensureDefaultPlatformSettings() {
    const definitions = [
      ...Object.values(PLATFORM_SETTING_DEFINITIONS),
      ...FEATURE_SETTING_DEFINITIONS.map((definition) => ({
        defaultValue: getFeatureSettingDefaultValue(definition),
        key: definition.key,
        scope: definition.scope,
        valueOptions:
          "valueOptions" in definition ? definition.valueOptions : undefined,
        valueType: definition.valueType,
      })),
    ];
    for (const definition of definitions) {
      const existing = await this.platformSettingRepository.findOne({
        where: { name: definition.key },
      });
      if (existing) {
        const expectedScope = definition.scope ?? "platform";
        const expectedOptions = getDefinitionValueOptions(definition);
        if (
          existing.scope !== expectedScope ||
          existing.valueType !== definition.valueType ||
          JSON.stringify(existing.valueOptions) !== JSON.stringify(expectedOptions)
        ) {
          existing.scope = expectedScope;
          existing.valueOptions = expectedOptions;
          existing.valueType = definition.valueType;
          await this.platformSettingRepository.save(existing);
        }
        continue;
      }
      try {
        await this.platformSettingRepository.save(
          this.platformSettingRepository.create({
            name: definition.key,
            scope: definition.scope ?? "platform",
            value: definition.defaultValue ?? null,
            valueOptions: getDefinitionValueOptions(definition),
            valueType: definition.valueType,
          }),
        );
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
      }
    }
  }

  private async savePlatformSettingsInTransaction(
    manager: EntityManager,
    entries: ReturnType<typeof parseSettingsPayload>,
  ) {
    const repository = manager.getRepository(PlatformSetting);
    const tenantRepository = manager.getRepository(TenantSetting);
    const invalidations: AppliedSettingsInvalidation[] = [];
    for (const entry of entries) {
      const definition = getSettingDefinitionByKey(entry.name);
      if (entry.value === null || entry.value === undefined) {
        if (definition) {
          throw new BadRequestException("预定义设置不能删除");
        }
        const tenantOverrides = await tenantRepository.find({
          select: { name: true, tenantId: true },
          where: { name: entry.name },
        });
        await tenantRepository.delete({ name: entry.name });
        await repository.delete({ name: entry.name });
        invalidations.push({ cacheKey: this.platformCacheKey(entry.name), name: entry.name, scope: "platform", value: null });
        for (const override of tenantOverrides) {
          invalidations.push({
            cacheKey: this.tenantCacheKey(override.tenantId, entry.name),
            name: entry.name,
            scope: "tenant",
            tenantId: override.tenantId,
            value: null,
          });
        }
        continue;
      }
      const existing = await repository.findOne({ where: { name: entry.name } });
      const normalized = normalizeSettingEntry(entry, [existing]);
      const setting = existing ?? repository.create({ name: entry.name });
      setting.scope = definition?.scope ?? normalizeSettingScope(
        entry.scope ?? existing?.scope ?? "platform",
      );
      setting.value = this.encodePersistedSettingValue(
        normalized.value,
        normalized.valueType,
        entry.value,
        existing?.value,
      );
      setting.valueOptions = normalized.valueOptions;
      setting.valueType = normalized.valueType;
      const persisted = await repository.save(setting);
      invalidations.push({
        cacheKey: this.platformCacheKey(entry.name),
        name: entry.name,
        scope: "platform",
        value: persisted.value,
        valueType: persisted.valueType,
      });
    }
    return invalidations;
  }

  private async saveTenantSettingsInTransaction(
    manager: EntityManager,
    tenantId: string,
    entries: ReturnType<typeof parseSettingsPayload>,
    platformSettings: PlatformSetting[],
  ) {
    const repository = manager.getRepository(TenantSetting);
    const platformByName = new Map(platformSettings.map((setting) => [setting.name, setting]));
    const invalidations: AppliedSettingsInvalidation[] = [];
    for (const entry of entries) {
      const existing = await repository.findOne({ where: { name: entry.name, tenantId } });
      const platformSetting = platformByName.get(entry.name) ?? null;
      if (entry.scope !== undefined && entry.scope !== "tenant") {
        throw new BadRequestException("工作空间参数范围必须为 tenant");
      }
      if (entry.value === null || entry.value === undefined) {
        if (platformSetting && !isTenantOverridableSetting(platformSetting)) {
          throw new BadRequestException("该设置不允许工作空间覆盖");
        }
        if (!platformSetting && !existing) {
          throw new BadRequestException("未知的工作空间设置");
        }
        await repository.delete({ name: entry.name, tenantId });
        invalidations.push({ cacheKey: this.tenantCacheKey(tenantId, entry.name), name: entry.name, scope: "tenant", tenantId, value: null });
        continue;
      }
      if (platformSetting && !isTenantOverridableSetting(platformSetting)) {
        throw new BadRequestException("该设置不允许工作空间覆盖");
      }
      if (!platformSetting && !existing && entry.scope !== "tenant") {
        throw new BadRequestException("新增工作空间参数必须显式使用 tenant 范围");
      }
      const normalized = normalizeSettingEntry(entry, [
        existing,
        platformSetting,
      ]);
      const setting = existing ?? repository.create({ name: entry.name, tenantId });
      setting.value = this.encodePersistedSettingValue(
        normalized.value,
        normalized.valueType,
        entry.value,
        existing?.value,
      );
      setting.valueOptions = normalized.valueOptions;
      setting.valueType = normalized.valueType;
      const persisted = await repository.save(setting);
      invalidations.push({
        cacheKey: this.tenantCacheKey(tenantId, entry.name),
        name: entry.name,
        scope: "tenant",
        tenantId,
        value: persisted.value,
        valueType: persisted.valueType,
      });
    }
    return invalidations;
  }

  private async applySettingsInvalidation(invalidation: AppliedSettingsInvalidation) {
    if (invalidation.value === null) await this.deleteCache(invalidation.cacheKey);
    else {
      await this.setCache(
        invalidation.cacheKey,
        this.encodeCachedSettingValue(
          invalidation.value,
          invalidation.valueType,
        ),
      );
    }
    await this.publishSettingsInvalidation(
      invalidation.scope === "platform"
        ? { name: invalidation.name, scope: "platform" }
        : { name: invalidation.name, scope: "tenant", tenantId: invalidation.tenantId },
    );
  }

  private findTenantSettings(tenantId: string) {
    const repository =
      this.tenantContext
        ?.current(false)
        ?.manager.getRepository(TenantSetting) ??
      this.tenantSettingRepository;
    return (
      repository?.find({
        order: { name: "ASC" },
        where: { tenantId },
      }) ?? Promise.resolve([])
    );
  }

  private runTenantTransaction<T>(work: (manager: EntityManager) => Promise<T>) {
    const manager = this.tenantContext?.current(false)?.manager;
    if (manager) return work(manager);
    if (!this.tenantSettingRepository) throw new Error("TenantSetting repository is not configured");
    return this.tenantSettingRepository.manager.transaction(work);
  }

  private requireTenantId(explicitTenantId?: string) {
    const tenantId = explicitTenantId?.trim() ?? this.tenantContext?.current(false)?.tenantId;
    if (!tenantId) throw new Error("Tenant context is required for settings");
    return tenantId;
  }

  private encodePersistedSettingValue(
    value: string | null,
    valueType: SettingValueType,
    submittedValue: unknown,
    existingValue?: string | null,
  ) {
    if (value === null || valueType !== "secret") return value;
    if (
      submittedValue === SECRET_SETTING_MASK &&
      existingValue &&
      isEncryptedSettingSecret(existingValue)
    ) {
      return existingValue;
    }
    return encryptSettingSecret(value, this.settingEncryptionKey());
  }

  private decodePersistedSettingValue(
    name: string,
    value: string | null,
    valueType: SettingValueType | string | null | undefined,
  ) {
    if (
      value === null ||
      resolveSettingValueType(name, valueType) !== "secret"
    ) {
      return value;
    }
    return decryptSettingSecret(value, this.settingEncryptionKey());
  }

  private encodeCachedSettingValue(
    value: string | null,
    valueType?: SettingValueType | string | null,
  ) {
    if (value === null) return null;
    return valueType === "secret" ? `${SECRET_CACHE_PREFIX}${value}` : value;
  }

  private decodeCachedSettingValue(value: string) {
    return value.startsWith(SECRET_CACHE_PREFIX)
      ? decryptSettingSecret(
          value.slice(SECRET_CACHE_PREFIX.length),
          this.settingEncryptionKey(),
        )
      : value;
  }

  private settingEncryptionKey() {
    return (
      this.configService?.get<string>("settings.encryptionKey") ??
      process.env.SETTINGS_ENCRYPTION_KEY ??
      process.env.AUTH_SESSION_SECRET ??
      process.env.JWT_SECRET ??
      "hermes-swarm-local-settings-secret"
    );
  }

  private platformCacheKey(name: string) { return `settings:platform:${name}`; }
  private tenantCacheKey(tenantId: string, name: string) { return `settings:${tenantId}:tenant:${name}`; }

  private async getCache(key: string) {
    const client = await this.getRedisClient();
    if (!client) return null;
    try { return await client.get(key); } catch { return null; }
  }
  private async setCache(key: string, value: string | null) {
    const client = await this.getRedisClient();
    if (!client) return;
    try { if (value === null) await client.del(key); else await client.set(key, value); } catch {}
  }
  private async deleteCache(key: string) {
    const client = await this.getRedisClient();
    if (!client) return;
    try { await client.del(key); } catch {}
  }
  private async publishSettingsInvalidation(event: SettingsInvalidationEvent) {
    const client = await this.getRedisClient();
    if (!client) return;
    try { await client.publish("settings:invalidate", JSON.stringify({ ...event, at: new Date().toISOString() })); } catch {}
  }
  private async getRedisClient() {
    try { return await this.redisService.getClient(); } catch { return null; }
  }
}

type SettingsInvalidationEvent =
  | { name: string; scope: "platform" }
  | { name: string; scope: "tenant"; tenantId: string };
type AppliedSettingsInvalidation =
  | {
      cacheKey: string;
      name: string;
      scope: "platform";
      value: string | null;
      valueType?: SettingValueType;
    }
  | {
      cacheKey: string;
      name: string;
      scope: "tenant";
      tenantId: string;
      value: string | null;
      valueType?: SettingValueType;
    };

function getDefinitionValueOptions(definition: unknown) {
  const valueOptions = definition && typeof definition === "object" && "valueOptions" in definition
    ? (definition as { valueOptions?: unknown }).valueOptions
    : null;
  return Array.isArray(valueOptions) ? ([...valueOptions] as SettingValueOption[]) : null;
}

function toPlatformSettingDto(setting: PlatformSetting) {
  const valueType = resolveSettingValueType(setting.name, setting.valueType);
  return {
    id: setting.id,
    name: setting.name,
    scope: setting.scope,
    value: maskSettingValue(setting.value, valueType),
    valueOptions: resolveSettingValueOptions(setting.name, setting.valueOptions),
    valueType,
  };
}

function isTenantOverridableSetting(setting: PlatformSetting) {
  const definition = getSettingDefinitionByKey(setting.name);
  return definition ? definition.scope === "tenant" : setting.scope === "tenant";
}

function normalizeSettingScope(value: unknown): "platform" | "tenant" {
  if (value === "platform" || value === "tenant") return value;
  throw new BadRequestException("设置范围无效");
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as { code?: string; driverError?: { code?: string } };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}
