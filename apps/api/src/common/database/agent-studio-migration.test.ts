import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { AgentStudio2026072500005 } from "./migrations/2026072500005-AgentStudio.js";

describe("Agent Studio migration", () => {
  it("creates workspace-bound Drafts and immutable published Versions", async () => {
    const statements: string[] = [];
    await new AgentStudio2026072500005().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);

    const sql = statements.join("\n");
    for (const table of ["agents", "agent_drafts", "agent_versions"]) {
      assert.match(sql, new RegExp(`CREATE TABLE "${table}"`));
    }
    assert.match(sql, /UNIQUE \("workspace_id", "id"\)/);
    assert.match(
      sql,
      /FOREIGN KEY \("workspace_id", "agent_id"\)[\s\S]*REFERENCES "agents"\("workspace_id", "id"\)/,
    );
    assert.match(sql, /TR_agent_versions_immutable/);
    assert.match(sql, /"api_version" character varying\(32\) NOT NULL/);
    assert.match(sql, /CHK_agent_versions_api_version/);
    assert.match(sql, /BEFORE UPDATE OR DELETE ON "agent_versions"/);
    assert.match(sql, /published Agent versions are immutable/);
    assert.doesNotMatch(
      sql,
      /ROW LEVEL SECURITY|CREATE POLICY|current_setting|set_config/,
    );
  });

  it("backfills Agent operations and page access for workspace administrators", async () => {
    const calls: Array<{ parameters?: unknown[]; sql: string }> = [];
    await new AgentStudio2026072500005().up({
      query: async (sql: string, parameters?: unknown[]) => {
        calls.push({ parameters, sql });
        return undefined;
      },
    } as unknown as QueryRunner);

    const permissionCodes = calls
      .filter(({ sql }) => sql.includes('INSERT INTO "permissions"'))
      .map(({ parameters }) => parameters?.[0]);
    assert.ok(permissionCodes.includes("agent.ai_configuration.publish:workspace"));
    assert.ok(permissionCodes.includes("page.agents.access:workspace"));
    const pageAccess = calls.find(
      ({ parameters }) => parameters?.[0] === "page.agents.access:workspace",
    );
    assert.equal(
      pageAccess?.parameters?.[11],
      "允许设计、保存和发布当前工作空间的智能助手。",
    );

    const backfill = calls.find(({ sql }) =>
      sql.includes('INSERT INTO "role_permissions"'),
    );
    assert.ok(backfill);
    assert.deepEqual(backfill.parameters?.[1], [
      "workspace-owner",
      "workspace-admin",
    ]);
  });

  it("refuses a destructive rollback", async () => {
    await assert.rejects(
      () => new AgentStudio2026072500005().down(),
      /cannot be rolled back safely/,
    );
  });
});
