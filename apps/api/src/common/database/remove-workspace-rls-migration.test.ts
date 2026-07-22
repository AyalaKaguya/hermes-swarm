import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { RemoveWorkspaceRls2026072200001 } from "./migrations/2026072200001-RemoveWorkspaceRls.js";

describe("remove workspace RLS migration", () => {
  it("removes only known policies, disables RLS, and revokes the legacy role ACL", async () => {
    const statements: string[] = [];
    await new RemoveWorkspaceRls2026072200001().up({
      query: async (sql: string) => {
        statements.push(sql);
        return [];
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");

    assert.match(sql, /FROM pg_policies AS policy/);
    assert.equal((sql.match(/DROP POLICY IF EXISTS/g) ?? []).length, 19);
    assert.equal((sql.match(/NO FORCE ROW LEVEL SECURITY/g) ?? []).length, 19);
    assert.equal((sql.match(/DISABLE ROW LEVEL SECURITY/g) ?? []).length, 19);
    assert.match(
      sql,
      /DROP POLICY IF EXISTS "workspace_isolation_tickets" ON "public"\."tickets"/,
    );
    assert.match(
      sql,
      /ALTER TABLE "public"\."tickets" NO FORCE ROW LEVEL SECURITY/,
    );
    assert.match(
      sql,
      /ALTER TABLE "public"\."tickets" DISABLE ROW LEVEL SECURITY/,
    );
    assert.match(
      sql,
      /DROP POLICY IF EXISTS "workspace_isolation_login_audit_logs" ON "public"\."login_audit_logs"/,
    );
    assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public/);
    assert.match(sql, /REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public/);
    assert.match(sql, /REVOKE ALL PRIVILEGES ON SCHEMA public/);
    assert.doesNotMatch(sql, /DROP ROLE/i);
    assert.doesNotMatch(sql, /DROP (?:TABLE|INDEX|CONSTRAINT)|DELETE FROM/i);
  });

  it("fails before changing policies when an unknown policy is present", async () => {
    const statements: string[] = [];
    await assert.rejects(
      () =>
        new RemoveWorkspaceRls2026072200001().up({
          query: async (sql: string) => {
            statements.push(sql);
            return [
              {
                policyname: "dba_custom_ticket_policy",
                schemaname: "public",
                tablename: "tickets",
              },
            ];
          },
        } as unknown as QueryRunner),
      /unknown policies exist: public\.tickets\.dba_custom_ticket_policy/,
    );
    assert.equal(statements.length, 1);
    assert.match(statements[0], /FROM pg_policies AS policy/);
  });

  it("does not offer an unsafe down migration", async () => {
    await assert.rejects(
      () => new RemoveWorkspaceRls2026072200001().down(),
      /cannot be rolled back safely/,
    );
  });
});
