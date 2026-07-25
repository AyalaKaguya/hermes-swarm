import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { ControlledToolGateway2026072500003 } from "./migrations/2026072500003-ControlledToolGateway.js";

describe("controlled tool gateway migration", () => {
  it("creates immutable tool versions and workspace-safe connection grants", async () => {
    const statements: string[] = [];
    await new ControlledToolGateway2026072500003().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);

    const sql = statements.join("\n");
    for (const table of [
      "tool_definitions",
      "tool_definition_versions",
      "tool_network_policies",
      "tool_definition_network_policies",
      "workspace_tool_connections",
      "workspace_tool_grants",
    ]) {
      assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
    }
    assert.match(sql, /"schema_version" character varying\(48\)/);
    assert.match(sql, /"content_locked" boolean NOT NULL DEFAULT true/);
    assert.match(sql, /UNIQUE \("id", "workspace_id"\)/);
    assert.match(
      sql,
      /FOREIGN KEY \("connection_id", "workspace_id"\)[\s\S]*REFERENCES "workspace_tool_connections"\("id", "workspace_id"\)/,
    );
    assert.match(sql, /TR_tool_definition_versions_immutable/);
    assert.match(sql, /TR_tool_definition_network_policies_immutable/);
    assert.match(sql, /FOR UPDATE/);
    assert.match(sql, /schema_version" IS DISTINCT FROM OLD\."schema_version/);
    assert.match(sql, /published tool version content is immutable/);
    assert.doesNotMatch(sql, /ROW LEVEL SECURITY|CREATE POLICY|current_setting|set_config/);
  });

  it("drops dependent objects before their parents", async () => {
    const statements: string[] = [];
    await new ControlledToolGateway2026072500003().down({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);

    assert.ok(
      statements.indexOf('DROP TABLE "workspace_tool_grants"') <
        statements.indexOf('DROP TABLE "workspace_tool_connections"'),
    );
    assert.equal(statements.at(-1), 'DROP TABLE "tool_definitions"');
  });
});
