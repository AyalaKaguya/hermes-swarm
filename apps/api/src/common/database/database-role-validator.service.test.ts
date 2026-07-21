import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseRoleValidatorService } from "./database-role-validator.service.js";

describe("DatabaseRoleValidatorService", () => {
  it("accepts a non-bypass workspace role and bypass-capable platform role", async () => {
    const service = createService(
      role("hermes_workspace_app", false, false),
      role("hermes_platform_app", true, false),
    );
    await assert.doesNotReject(() => service.onApplicationBootstrap());
  });

  it("rejects a workspace connection that can bypass RLS", async () => {
    const service = createService(
      role("hermes_workspace_app", false, true),
      role("hermes_platform_app", true, false),
    );
    await assert.rejects(
      () => service.onApplicationBootstrap(),
      /must not bypass RLS/,
    );
  });

  it("rejects a platform connection that cannot cross workspace RLS", async () => {
    const service = createService(
      role("hermes_workspace_app", false, false),
      role("hermes_platform_app", false, false),
    );
    await assert.rejects(
      () => service.onApplicationBootstrap(),
      /must be allowed to bypass workspace RLS/,
    );
  });
});

function createService(workspace: unknown, platform: unknown) {
  return new DatabaseRoleValidatorService(
    { getOrThrow: () => true } as any,
    { query: async () => [workspace] } as any,
    { query: async () => [platform] } as any,
  );
}

function role(current_user: string, rolsuper: boolean, rolbypassrls: boolean) {
  return { current_user, rolbypassrls, rolsuper };
}
