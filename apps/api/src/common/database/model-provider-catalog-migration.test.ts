import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { ModelProviderCatalog2026072500001 } from "./migrations/2026072500001-ModelProviderCatalog.js";

describe("model provider catalog migration", () => {
  it("creates separate platform and workspace catalogs with fail-closed defaults", async () => {
    const statements: string[] = [];
    const migration = new ModelProviderCatalog2026072500001();
    assert.match(migration.name, /\d{13}$/);
    await migration.up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);

    const sql = statements.join("\n");
    for (const table of [
      "platform_model_providers",
      "workspace_model_providers",
      "platform_model_deployments",
      "workspace_model_deployments",
      "workspace_model_grants",
      "workspace_model_defaults",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
    }
    assert.match(sql, /CHK_workspace_model_providers_secret_state/);
    assert.match(sql, /FOREIGN KEY \("workspace_id", "provider_id"\)/);
    assert.match(sql, /FOREIGN KEY \("workspace_id", "platform_deployment_id"\)/);
    assert.match(sql, /CHK_workspace_model_defaults_single_deployment/);
    assert.match(sql, /UQ_workspace_model_defaults_workspace_capability/);
    assert.doesNotMatch(sql, /ROW LEVEL SECURITY|CREATE POLICY|current_setting|set_config/i);
  });

  it("drops only the provider catalog in reverse dependency order", async () => {
    const statements: string[] = [];
    await new ModelProviderCatalog2026072500001().down({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);

    assert.deepEqual(statements, [
      `DROP TABLE "workspace_model_defaults"`,
      `DROP TABLE "workspace_model_grants"`,
      `DROP TABLE "workspace_model_deployments"`,
      `DROP TABLE "platform_model_deployments"`,
      `DROP TABLE "workspace_model_providers"`,
      `DROP TABLE "platform_model_providers"`,
    ]);
  });
});
