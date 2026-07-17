import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantOwnedBaseEntity } from "@hermes-swarm/core";
import { getMetadataArgsStorage, type QueryRunner } from "typeorm";
import migrationDataSource from "./migration-data-source.js";
import { TENANT_DATABASE_GUCS } from "./tenant-database.constants.js";
import {
  TENANT_RLS_GAPS,
  TENANT_RLS_TABLES,
  WorkspaceModelBaseline2026071500001,
} from "./migrations/202607150001-WorkspaceModelBaseline.js";

describe("workspace model baseline migration", () => {
  it("builds TypeORM metadata without removed OA entities", async () => {
    await (
      migrationDataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const tables = new Set(
      migrationDataSource.entityMetadatas.map((metadata) => metadata.tableName),
    );
    for (const table of ["tenants", "organizations", "users", "roles"]) {
      assert.equal(tables.has(table), true);
    }
    for (const removed of [
      "departments",
      "user_departments",
      "department_dispatch_relations",
      "organization_groups",
      "organization_group_members",
      "organization_settings",
    ]) {
      assert.equal(tables.has(removed), false, `${removed} must stay removed`);
    }
  });

  it("covers every decorated tenant-owned entity with forced RLS", async () => {
    const tenantOwnedTables = getMetadataArgsStorage()
      .tables.filter(
        (table) =>
          typeof table.target === "function" &&
          table.target.prototype instanceof TenantOwnedBaseEntity,
      )
      .map((table) => table.name)
      .filter((name): name is string => Boolean(name))
      .sort();
    assert.deepEqual(
      tenantOwnedTables.filter((table) => !TENANT_RLS_TABLES.includes(table as never)),
      [],
    );
    assert.ok(TENANT_RLS_TABLES.includes("access_audit_logs"));

    const statements: string[] = [];
    await new WorkspaceModelBaseline2026071500001().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");
    for (const table of TENANT_RLS_TABLES) {
      assert.match(sql, new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));
      assert.match(sql, new RegExp(`tenant_isolation_${table}`));
    }
    assert.match(
      sql,
      new RegExp(`current_setting\\('${TENANT_DATABASE_GUCS.tenantId}'`),
    );
    assert.match(sql, /CREATE ROLE hermes_tenant_app LOGIN NOBYPASSRLS/);
    assert.deepEqual([...TENANT_RLS_GAPS], []);
  });

  it("enforces the organization tree and tenant-consistent business references", async () => {
    const statements: string[] = [];
    await new WorkspaceModelBaseline2026071500001().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");
    assert.match(sql, /UQ_organizations_single_root/);
    assert.match(sql, /FK_organizations_tenant_parent/);
    assert.match(sql, /FK_user_org_roles_tenant_membership/);
    assert.match(sql, /FK_roles_tenant_organization/);
    assert.match(sql, /FK_invites_tenant_workspace_role/);
    assert.match(sql, /FK_tickets_tenant_source_org/);
    assert.match(sql, /source_organization_id" uuid NOT NULL/);
    assert.match(sql, /CHK_roles_scope/);
    assert.match(sql, /CHK_integration_tokens_tenant_scope/);
    assert.doesNotMatch(sql, /department_id|organization_groups|organization_settings/);
  });
});
