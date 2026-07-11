import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FeatureAccessService } from "./feature-access.service.js";

describe("FeatureAccessService", () => {
  it("resolves platform features from the platform setting", async () => {
    const calls: string[] = [];
    const service = createService(calls);
    assert.equal(await service.isFeatureEnabled("system:maintenance:enabled"), false);
    assert.deepEqual(calls, ["platform:system:maintenance:enabled"]);
  });

  it("resolves tenant features through the tenant override chain", async () => {
    const calls: string[] = [];
    const service = createService(calls);
    assert.equal(
      await service.isFeatureEnabled("feature:password-reset:enabled"),
      true,
    );
    assert.deepEqual(calls, ["tenant:tenant-1:feature:password-reset:enabled"]);
  });

  it("resolves organization features with a tenant-bound organization lookup", async () => {
    const calls: string[] = [];
    const service = createService(calls);
    assert.equal(
      await service.isFeatureEnabled("feature:email:enabled", {
        organizationId: "org-1",
      }),
      true,
    );
    assert.deepEqual(calls, ["organization:tenant-1:org-1:feature:email:enabled"]);
  });
});

function createService(calls: string[]) {
  const settings = {
    async getPlatformValue(name: string) {
      calls.push(`platform:${name}`);
      return "false";
    },
    async getTenantValue(tenantId: string, name: string) {
      calls.push(`tenant:${tenantId}:${name}`);
      return "true";
    },
    async getOrganizationValue(
      organizationId: string,
      name: string,
      _fallback: string,
      tenantId: string,
    ) {
      calls.push(`organization:${tenantId}:${organizationId}:${name}`);
      return "true";
    },
  };
  const tenantContext = {
    current: () => ({ tenantId: "tenant-1" }),
    repository: () => ({
      findOne: async ({ where }: { where: { id: string; tenantId: string } }) =>
        where.id === "org-1" && where.tenantId === "tenant-1"
          ? { id: where.id, tenantId: where.tenantId }
          : null,
    }),
  };
  return new FeatureAccessService(settings as never, tenantContext as never);
}
