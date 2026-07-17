import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PlatformSetting, TenantSetting } from "@hermes-swarm/core";
import { SettingsService } from "./settings.service.js";

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
});

function createState(options: { tenantValue?: string } = {}) {
  const platformSettings = [{
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
