import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ORGANIZATION_RLS_TABLES,
  OrganizationScopeRls2026072000002,
  organizationScopePredicate,
} from "./migrations/2026072000002-OrganizationScopeRls.js";

describe("organization scope RLS migration", () => {
  it("fails closed and binds organization-owned rows to the exact scope", () => {
    const predicate = organizationScopePredicate("organization_id");
    assert.match(predicate, /app\.tenant_id/);
    assert.match(predicate, /app\.scope_level.*= 'tenant'/);
    assert.match(predicate, /app\.scope_level.*= 'organization'/);
    assert.match(predicate, /"organization_id".*app\.organization_id/);
    assert.equal(predicate.includes("COALESCE"), false);
  });

  it("enables and forces RLS for every declared organization-owned table", async () => {
    const queries: string[] = [];
    await new OrganizationScopeRls2026072000002().up({
      query: async (sql: string) => {
        queries.push(sql);
      },
    } as any);

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
