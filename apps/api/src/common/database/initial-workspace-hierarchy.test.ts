import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkspaceOwnedBaseEntity } from "@hermes-swarm/core";
import { getMetadataArgsStorage, type QueryRunner } from "typeorm";
import migrationDataSource from "./migration-data-source.js";
import { WORKSPACE_DATABASE_GUCS } from "./workspace-database.constants.js";
import {
  WORKSPACE_RLS_GAPS,
  WORKSPACE_RLS_TABLES,
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
    for (const table of ["workspaces", "users", "roles", "user_workspace_roles"]) {
      assert.equal(tables.has(table), true);
    }
    for (const removed of [
      "departments",
      "user_departments",
      "department_dispatch_relations",
    ]) {
      assert.equal(tables.has(removed), false, `${removed} must stay removed`);
    }
  });

  it("covers every decorated workspace-owned entity with forced RLS", async () => {
    const workspaceOwnedTables = getMetadataArgsStorage()
      .tables.filter(
        (table) =>
          typeof table.target === "function" &&
          table.target.prototype instanceof WorkspaceOwnedBaseEntity,
      )
      .map((table) => table.name)
      .filter((name): name is string => Boolean(name))
      .sort();
    assert.deepEqual(
      workspaceOwnedTables.filter((table) => !WORKSPACE_RLS_TABLES.includes(table as never)),
      [],
    );
    assert.ok(WORKSPACE_RLS_TABLES.includes("access_audit_logs"));

    const statements: string[] = [];
    await new WorkspaceModelBaseline2026071500001().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");
    for (const table of WORKSPACE_RLS_TABLES) {
      assert.match(sql, new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));
      assert.match(sql, new RegExp(`workspace_isolation_${table}`));
    }
    assert.match(
      sql,
      new RegExp(`current_setting\\('${WORKSPACE_DATABASE_GUCS.workspaceId}'`),
    );
    assert.match(sql, /CREATE ROLE hermes_workspace_app LOGIN NOBYPASSRLS/);
    assert.deepEqual([...WORKSPACE_RLS_GAPS], []);
  });

  it("enforces workspace roles and workspace-consistent business references", async () => {
    const statements: string[] = [];
    await new WorkspaceModelBaseline2026071500001().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");
    assert.match(sql, /UQ_user_workspace_roles/);
    assert.match(sql, /FK_user_workspace_roles_workspace_role/);
    assert.match(sql, /FK_invites_workspace_role/);
    assert.match(sql, /CHK_roles_scope/);
    assert.match(sql, /TR_platform_memberships_role_scope/);
    assert.match(sql, /TR_role_permissions_scope/);
    assert.match(sql, /CHK_integration_tokens_workspace_scope/);
    assert.doesNotMatch(sql, /department_id/);
  });
});
