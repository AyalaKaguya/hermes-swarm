import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { PlatformSetting, TenantSetting } from "@hermes-swarm/core";
import { SettingsService } from "./settings.service.js";
import {
  decryptSettingSecret,
  isEncryptedSettingSecret,
} from "./settings-secret-codec.js";

describe("SettingsService platform-to-tenant fallback", () => {
  it("uses the platform value when the workspace has no override", async () => {
    const state = createState();
    assert.equal(
      await state.service.getTenantValue("tenant-a", "feature:ticketing:enabled"),
      "true",
    );
  });

  it("uses the workspace override before the hidden platform default", async () => {
    const state = createState({ tenantValue: "false" });
    assert.equal(
      await state.service.getTenantValue("tenant-a", "feature:ticketing:enabled"),
      "false",
    );
  });

  it("does not expose an organization settings layer", () => {
    const state = createState({ tenantValue: "false" });
    assert.equal("getOrganizationValue" in state.service, false);
  });

  it("marks platform runtime defaults as platform sources", async () => {
    const state = createState({
      platformSettings: [
        {
          id: "platform-currency",
          name: "tenant.defaultCurrency",
          scope: "tenant",
          value: "HKD",
          valueOptions: null,
          valueType: "enum",
        },
      ],
    });

    const preferences = await state.service.resolvePlatformRuntimePreferences(null);
    assert.equal(preferences.currency, "HKD");
    assert.equal(preferences.sources.currency, "platform");
  });

  it("rejects platform-only and implicit unknown workspace overrides", async () => {
    const state = createState();
    const manager = {
      getRepository: () => ({ findOne: async () => null }),
    };
    const save = (name: string) =>
      (state.service as any).saveTenantSettingsInTransaction(
        manager,
        "tenant-a",
        [{ name, value: "changed" }],
        [
          {
            name: "platform.publicBaseUrl",
            scope: "platform",
            value: "https://example.com",
            valueOptions: null,
            valueType: "string",
          },
        ],
      );

    await assert.rejects(() => save("platform.publicBaseUrl"), BadRequestException);
    await assert.rejects(() => save("custom.unknown"), BadRequestException);
  });

  it("creates an explicit workspace-only parameter", async () => {
    const state = createState();
    const saved: Array<Record<string, unknown>> = [];
    const repository = {
      create: (value: Record<string, unknown>) => ({ id: "custom", ...value }),
      findOne: async () => null,
      save: async (value: Record<string, unknown>) => {
        saved.push(value);
        return value;
      },
    };
    const manager = { getRepository: () => repository };

    await (state.service as any).saveTenantSettingsInTransaction(
      manager,
      "tenant-a",
      [{
        name: "API_BASE_URL",
        scope: "tenant",
        value: "https://api.example.com",
        valueType: "string",
      }],
      [],
    );

    assert.equal(saved[0]?.name, "API_BASE_URL");
    assert.equal(saved[0]?.tenantId, "tenant-a");
    assert.equal(saved[0]?.value, "https://api.example.com");
  });

  it("encrypts workspace secret parameters before persistence", async () => {
    const state = createState();
    const saved: Array<Record<string, any>> = [];
    const repository = {
      create: (value: Record<string, unknown>) => ({ id: "secret", ...value }),
      findOne: async () => null,
      save: async (value: Record<string, unknown>) => {
        saved.push(value);
        return value;
      },
    };
    const manager = { getRepository: () => repository };

    await (state.service as any).saveTenantSettingsInTransaction(
      manager,
      "tenant-a",
      [{
        name: "DATABASE_PASSWORD",
        scope: "tenant",
        value: "database-password",
        valueType: "secret",
      }],
      [],
    );

    const persistedValue = String(saved[0]?.value);
    assert.equal(isEncryptedSettingSecret(persistedValue), true);
    assert.equal(
      decryptSettingSecret(
        persistedValue,
        "hermes-swarm-local-settings-secret",
      ),
      "database-password",
    );
  });

  it("lists workspace-only parameters through the current RLS manager", async () => {
    let baseRepositoryReads = 0;
    let tenantContextReads = 0;
    const tenantSettings = [{
      id: "tenant-secret",
      name: "DATABASE_PASSWORD",
      tenantId: "tenant-a",
      value: "enc:v1:encrypted",
      valueOptions: null,
      valueType: "secret",
    }];
    const platformRepository = {
      find: async () => [],
    };
    const tenantRepository = {
      find: async () => {
        baseRepositoryReads += 1;
        return [];
      },
    };
    const manager = {
      getRepository: (target: unknown) => {
        assert.equal(target, TenantSetting);
        return {
          find: async () => {
            tenantContextReads += 1;
            return tenantSettings;
          },
        };
      },
    };
    const service = new SettingsService(
      platformRepository as never,
      { getClient: async () => { throw new Error("redis offline"); } } as never,
      tenantRepository as never,
      { current: () => ({ manager, tenantId: "tenant-a" }) } as never,
    );

    const result = await service.listTenantSettings("tenant-a");

    assert.equal(baseRepositoryReads, 0);
    assert.equal(tenantContextReads, 1);
    assert.equal(result[0]?.name, "DATABASE_PASSWORD");
    assert.equal(result[0]?.isCustom, true);
    assert.equal(result[0]?.value, "********");
  });

  it("allows null to remove a legacy workspace-only setting", async () => {
    const state = createState();
    const deleted: unknown[] = [];
    const manager = {
      getRepository: () => ({
        delete: async (where: unknown) => deleted.push(where),
        findOne: async () => ({ id: "legacy", name: "legacy.key" }),
      }),
    };
    await (state.service as any).saveTenantSettingsInTransaction(
      manager,
      "tenant-a",
      [{ name: "legacy.key", value: null }],
      [],
    );
    assert.deepEqual(deleted, [{ name: "legacy.key", tenantId: "tenant-a" }]);
  });

  it("rejects null for unknown and platform-only settings", async () => {
    const state = createState();
    const manager = {
      getRepository: () => ({
        delete: async () => undefined,
        findOne: async () => null,
      }),
    };
    const remove = (name: string) =>
      (state.service as any).saveTenantSettingsInTransaction(
        manager,
        "tenant-a",
        [{ name, value: null }],
        [
          {
            name: "platform.publicBaseUrl",
            scope: "platform",
            value: "https://example.com",
            valueOptions: null,
            valueType: "string",
          },
        ],
      );

    await assert.rejects(
      () => remove("platform.publicBaseUrl"),
      BadRequestException,
    );
    await assert.rejects(() => remove("custom.unknown"), BadRequestException);
  });
});

function createState(options: {
  platformSettings?: Array<{
    id: string;
    name: string;
    scope: "platform" | "tenant";
    value: string;
    valueOptions: null;
    valueType: string;
  }>;
  tenantValue?: string;
} = {}) {
  const platformSettings = options.platformSettings ?? [{
    id: "platform-setting",
    name: "feature:ticketing:enabled",
    scope: "platform",
    value: "true",
    valueOptions: null,
    valueType: "boolean",
  }];
  const tenantSettings = options.tenantValue === undefined ? [] : [{
    id: "tenant-setting",
    name: "feature:ticketing:enabled",
    tenantId: "tenant-a",
    value: options.tenantValue,
    valueOptions: null,
    valueType: "boolean",
  }];
  const platformRepository = {
    find: async () => platformSettings,
    findOne: async ({ where }: any) => platformSettings.find((item) => item.name === where.name) ?? null,
  };
  const tenantRepository = {
    find: async () => tenantSettings,
    findOne: async ({ where }: any) => tenantSettings.find((item) => item.name === where.name && item.tenantId === where.tenantId) ?? null,
    manager: { transaction: async (work: (manager: unknown) => unknown) => work({ getRepository: (target: unknown) => target === TenantSetting ? tenantRepository : platformRepository }) },
  };
  const service = new SettingsService(
    platformRepository as never,
    { getClient: async () => { throw new Error("redis offline"); } } as never,
    tenantRepository as never,
    { current: () => ({ tenantId: "tenant-a" }) } as never,
  );
  return { service };
}
