import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { OrganizationSetting, PlatformSetting } from "@hermes-swarm/core";
import { SettingsService } from "./settings.service.js";

describe("SettingsService consistency", () => {
  it("continues default platform setting initialization when a concurrent insert wins", async () => {
    const { service, store } = createService({
      failNextPlatformSaveWithUniqueError: true,
    });

    await service.onModuleInit();

    assert.ok(
      store.platform.size > 0,
      "default initialization should continue after one unique conflict",
    );
  });

  it("rolls back platform batch saves when a later setting is invalid", async () => {
    const { redis, service, store } = createService({
      platform: [
        makePlatformSetting({
          name: "platform.title",
          value: "Hermes",
          valueType: "string",
        }),
      ],
    });

    await assert.rejects(
      () =>
        service.savePlatformSettings({
          settings: [
            { name: "platform.title", value: "Updated" },
            { name: "feature:email:enabled", value: "yes" },
          ],
        }),
      BadRequestException,
    );

    assert.equal(store.platform.get("platform.title")?.value, "Hermes");
    assert.deepEqual(redis.commands, []);
  });

  it("rolls back organization deletions when a later setting is invalid", async () => {
    const { redis, service, store } = createService({
      organization: [
        makeOrganizationSetting({
          name: "custom.flag",
          organizationId: "org-1",
          value: "enabled",
          valueType: "string",
        }),
      ],
    });

    await assert.rejects(
      () =>
        service.saveOrganizationSettingsForOrganization("org-1", {
          settings: [
            { name: "custom.flag", value: null },
            { name: "feature:email:enabled", value: "yes" },
          ],
        }),
      BadRequestException,
    );

    assert.equal(store.organization.get("org-1:custom.flag")?.value, "enabled");
    assert.deepEqual(redis.commands, []);
  });

  it("updates cache and publishes invalidations only after a successful transaction", async () => {
    const { redis, service, store } = createService({
      platform: [
        makePlatformSetting({
          name: "platform.title",
          value: "Hermes",
          valueType: "string",
        }),
      ],
    });

    await service.savePlatformSettings({
      settings: [{ name: "platform.title", value: "Updated" }],
    });

    assert.equal(store.platform.get("platform.title")?.value, "Updated");
    assert.deepEqual(redis.commands, [
      { key: "settings:platform:platform.title", type: "set", value: "Updated" },
      { channel: "settings:invalidate", type: "publish" },
    ]);
  });
});

function createService(seed: {
  failNextPlatformSaveWithUniqueError?: boolean;
  organization?: OrganizationSetting[];
  platform?: PlatformSetting[];
} = {}) {
  const store = new FakeSettingsStore(seed);
  const redis = new FakeRedisClient();
  const manager = new FakeEntityManager(store);
  const platformRepository = new FakeSettingsRepository(
    PlatformSetting,
    store,
    manager,
    seed,
  );
  const organizationRepository = new FakeSettingsRepository(
    OrganizationSetting,
    store,
    manager,
    seed,
  );
  const service = new SettingsService(
    platformRepository as any,
    organizationRepository as any,
    { getClient: async () => redis } as any,
  );

  return { redis, service, store };
}

class FakeSettingsStore {
  readonly organization = new Map<string, OrganizationSetting>();
  readonly platform = new Map<string, PlatformSetting>();

  constructor(seed: {
    organization?: OrganizationSetting[];
    platform?: PlatformSetting[];
  } = {}) {
    for (const setting of seed.platform ?? []) {
      this.platform.set(setting.name, cloneSetting(setting));
    }
    for (const setting of seed.organization ?? []) {
      this.organization.set(
        organizationSettingKey(setting.organizationId, setting.name),
        cloneSetting(setting),
      );
    }
  }

  clone() {
    const next = new FakeSettingsStore();
    for (const [key, value] of this.platform) {
      next.platform.set(key, cloneSetting(value));
    }
    for (const [key, value] of this.organization) {
      next.organization.set(key, cloneSetting(value));
    }
    return next;
  }

  replaceWith(next: FakeSettingsStore) {
    this.platform.clear();
    this.organization.clear();
    for (const [key, value] of next.platform) {
      this.platform.set(key, cloneSetting(value));
    }
    for (const [key, value] of next.organization) {
      this.organization.set(key, cloneSetting(value));
    }
  }
}

class FakeEntityManager {
  constructor(private readonly store: FakeSettingsStore) {}

  async transaction<T>(callback: (manager: FakeEntityManager) => Promise<T>) {
    const transactionStore = this.store.clone();
    const transactionManager = new FakeEntityManager(transactionStore);
    const result = await callback(transactionManager);
    this.store.replaceWith(transactionStore);
    return result;
  }

  getRepository(entity: unknown) {
    return new FakeSettingsRepository(entity, this.store, this);
  }
}

class FakeSettingsRepository {
  readonly manager: FakeEntityManager;

  constructor(
    private readonly entity: unknown,
    private readonly store: FakeSettingsStore,
    manager: FakeEntityManager,
    private readonly options: { failNextPlatformSaveWithUniqueError?: boolean } = {},
  ) {
    this.manager = manager;
  }

  async find(options: { where?: Record<string, unknown> } = {}) {
    const values =
      this.entity === PlatformSetting
        ? [...this.store.platform.values()]
        : [...this.store.organization.values()];
    return values
      .filter((setting) => matchesWhere(setting, options.where))
      .map((setting) => cloneSetting(setting))
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  async findOne(options: { where: Record<string, unknown> }) {
    const setting =
      this.entity === PlatformSetting
        ? this.store.platform.get(String(options.where.name))
        : this.store.organization.get(
            organizationSettingKey(
              String(options.where.organizationId),
              String(options.where.name),
            ),
          );
    return setting ? cloneSetting(setting) : null;
  }

  create(input: Record<string, unknown>) {
    return {
      id: String(input.id ?? `setting-${Math.random()}`),
      scope: "global",
      value: null,
      valueOptions: null,
      valueType: "string",
      ...input,
    };
  }

  async save(input: PlatformSetting | OrganizationSetting) {
    if (
      this.entity === PlatformSetting &&
      this.options.failNextPlatformSaveWithUniqueError
    ) {
      this.options.failNextPlatformSaveWithUniqueError = false;
      throw { driverError: { code: "23505" } };
    }

    const setting = cloneSetting({
      id: input.id ?? `setting-${Math.random()}`,
      valueOptions: null,
      ...input,
    } as PlatformSetting | OrganizationSetting);

    if (this.entity === PlatformSetting) {
      this.store.platform.set(setting.name, setting as PlatformSetting);
      return cloneSetting(setting);
    }

    const organizationSetting = setting as OrganizationSetting;
    this.store.organization.set(
      organizationSettingKey(
        organizationSetting.organizationId,
        organizationSetting.name,
      ),
      organizationSetting,
    );
    return cloneSetting(organizationSetting);
  }

  async delete(where: Record<string, unknown>) {
    if (this.entity === PlatformSetting) {
      this.store.platform.delete(String(where.name));
      return;
    }
    this.store.organization.delete(
      organizationSettingKey(
        String(where.organizationId),
        String(where.name),
      ),
    );
  }
}

class FakeRedisClient {
  readonly commands: Array<Record<string, string>> = [];

  async get() {
    return null;
  }

  async set(key: string, value: string) {
    this.commands.push({ key, type: "set", value });
  }

  async del(key: string) {
    this.commands.push({ key, type: "del" });
  }

  async publish(channel: string) {
    this.commands.push({ channel, type: "publish" });
  }
}

function makePlatformSetting(
  input: Partial<PlatformSetting> & Pick<PlatformSetting, "name" | "value">,
) {
  return {
    id: input.id ?? `platform-${input.name}`,
    name: input.name,
    scope: input.scope ?? "global",
    value: input.value,
    valueOptions: input.valueOptions ?? null,
    valueType: input.valueType ?? "string",
  } as PlatformSetting;
}

function makeOrganizationSetting(
  input: Partial<OrganizationSetting> &
    Pick<OrganizationSetting, "name" | "organizationId" | "value">,
) {
  return {
    id: input.id ?? `organization-${input.organizationId}-${input.name}`,
    name: input.name,
    organizationId: input.organizationId,
    value: input.value,
    valueOptions: input.valueOptions ?? null,
    valueType: input.valueType ?? "string",
  } as OrganizationSetting;
}

function cloneSetting<T>(setting: T): T {
  return JSON.parse(JSON.stringify(setting)) as T;
}

function organizationSettingKey(organizationId: string, name: string) {
  return `${organizationId}:${name}`;
}

function matchesWhere(setting: unknown, where: Record<string, unknown> = {}) {
  return Object.entries(where).every(
    ([key, value]) => (setting as Record<string, unknown>)[key] === value,
  );
}
