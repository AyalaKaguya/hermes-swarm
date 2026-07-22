import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { AuditLogs2026071700002 } from "./migrations/202607170002-AuditLogs.js";

describe("audit logs migration", () => {
  it("adds operation context without installing database RLS", async () => {
    const statements: string[] = [];
    await new AuditLogs2026071700002().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");

    assert.match(sql, /ADD COLUMN "scope_type"/);
    assert.match(sql, /CREATE TABLE "login_audit_logs"/);
    assert.doesNotMatch(sql, /ROW LEVEL SECURITY/i);
    assert.doesNotMatch(sql, /CREATE POLICY/i);
    assert.doesNotMatch(sql, /hermes_workspace_app/i);
    assert.doesNotMatch(sql, /password|refresh_token|cookie/i);
  });
});
