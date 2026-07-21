import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { DatabaseRoleValidatorService } from "./database-role-validator.service.js";

describe("DatabaseRoleValidatorService", () => {
  it("skips role probes and warns when shared credentials run without strict RLS", async () => {
    let queryCount = 0;
    const warnings: string[] = [];
    const service = createService(
      role("shared", false, false),
      role("shared", false, false),
      {
        query: async () => {
          queryCount += 1;
          return [];
        },
        strictRls: false,
      },
    );
    (service as any).logger = {
      warn: (message: string) => warnings.push(message),
    };

    await assert.doesNotReject(() => service.onApplicationBootstrap());
    assert.equal(queryCount, 0);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /share one PostgreSQL URL/);
  });

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

function createService(
  workspace: unknown,
  platform: unknown,
  options: {
    query?: () => Promise<unknown[]>;
    strictRls?: boolean;
    workspaceUrl?: string;
    platformUrl?: string;
  } = {},
) {
  const query = options.query;
  return new DatabaseRoleValidatorService(
    {
      getOrThrow: (key: string) => {
        if (key === "database.strictRls") return options.strictRls ?? true;
        if (key === "database.workspaceUrl") {
          return options.workspaceUrl ?? "postgresql://shared.example/hermes";
        }
        if (key === "database.platformUrl") {
          return options.platformUrl ?? "postgresql://shared.example/hermes";
        }
        throw new Error(`Unexpected configuration key: ${key}`);
      },
    } as any,
    { query: query ?? (async () => [workspace]) } as any,
    { query: query ?? (async () => [platform]) } as any,
  );
}

function role(current_user: string, rolsuper: boolean, rolbypassrls: boolean) {
  return { current_user, rolbypassrls, rolsuper };
}
