import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORGANIZATION_RLS_TABLES,
  OrganizationScopeRls2026072000002,
} from "./migrations/2026072000002-OrganizationScopeRls.js";

describe("organization scope RLS migration", () => {
  it("fails closed and binds organization-owned rows to the exact scope", async () => {
    const queries = await runMigration();
    const policy = queries.find((sql) =>
      sql.includes('CREATE POLICY "tenant_isolation_roles"'),
    );
    assert.ok(policy);
    assert.match(policy, /app\.tenant_id/);
    assert.match(policy, /app\.scope_level.*= 'tenant'/);
    assert.match(policy, /app\.scope_level.*= 'organization'/);
    assert.match(policy, /"organization_id".*app\.organization_id/);
    assert.equal(policy.includes("COALESCE"), false);
  });

  it("enables and forces RLS for every declared organization-owned table", async () => {
    const queries = await runMigration();

    for (const table of Object.keys(ORGANIZATION_RLS_TABLES)) {
      assert.equal(
        queries.some((sql) => sql === `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`),
        true,
      );
      assert.equal(
        queries.some((sql) => sql === `ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`),
        true,
      );
      assert.equal(
        queries.some(
          (sql) =>
            sql.includes(`CREATE POLICY "tenant_isolation_${table}"`) &&
            sql.includes("WITH CHECK"),
        ),
        true,
      );
    }
  });
});

async function runMigration() {
  const queries: string[] = [];
  await new OrganizationScopeRls2026072000002().up({
    query: async (sql: string) => {
      queries.push(sql);
    },
  } as any);
  return queries;
}
