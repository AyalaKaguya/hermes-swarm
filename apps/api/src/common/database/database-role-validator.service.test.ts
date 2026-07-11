import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseRoleValidatorService } from "./database-role-validator.service.js";

describe("DatabaseRoleValidatorService", () => {
  it("accepts a non-bypass tenant role and bypass-capable platform role", async () => {
    const service = createService(
      role("hermes_tenant_app", false, false),
      role("hermes_platform_app", true, false),
    );
    await assert.doesNotReject(() => service.onApplicationBootstrap());
  });

  it("rejects a tenant connection that can bypass RLS", async () => {
    const service = createService(
      role("hermes_tenant_app", false, true),
      role("hermes_platform_app", true, false),
    );
    await assert.rejects(
      () => service.onApplicationBootstrap(),
      /must not bypass RLS/,
    );
  });

  it("rejects a platform connection that cannot cross tenant RLS", async () => {
    const service = createService(
      role("hermes_tenant_app", false, false),
      role("hermes_platform_app", false, false),
    );
    await assert.rejects(
      () => service.onApplicationBootstrap(),
      /must be allowed to bypass tenant RLS/,
    );
  });
});

function createService(tenant: unknown, platform: unknown) {
  return new DatabaseRoleValidatorService(
    { getOrThrow: () => true } as any,
    { query: async () => [tenant] } as any,
    { query: async () => [platform] } as any,
  );
}

function role(current_user: string, rolsuper: boolean, rolbypassrls: boolean) {
  return { current_user, rolbypassrls, rolsuper };
}
