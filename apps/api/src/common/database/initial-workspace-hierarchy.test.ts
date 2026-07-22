import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorkspaceOwnedBaseEntity } from "@hermes-swarm/core";
import { DataSource, getMetadataArgsStorage, type QueryRunner } from "typeorm";
import { DATABASE_ENTITIES } from "./database-entities.js";
import { WorkspaceModelBaseline2026071500001 } from "./migrations/202607150001-WorkspaceModelBaseline.js";

const metadataDataSource = new DataSource({
  type: "postgres",
  url: "postgresql://test.example/hermes-test",
  entities: [...DATABASE_ENTITIES],
  synchronize: false,
});

describe("workspace model baseline migration", () => {
  it("builds TypeORM metadata without removed OA entities", async () => {
    await (
      metadataDataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const tables = new Set(
      metadataDataSource.entityMetadatas.map((metadata) => metadata.tableName),
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

  it("keeps workspace-owned entities explicit without database RLS", async () => {
    await (
      metadataDataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();
    const workspaceOwnedTables = getMetadataArgsStorage()
      .tables.filter(
        (table) =>
          typeof table.target === "function" &&
          table.target.prototype instanceof WorkspaceOwnedBaseEntity,
      )
      .map((table) => table.name)
      .filter((name): name is string => Boolean(name))
      .sort();
    assert.ok(workspaceOwnedTables.includes("tickets"));
    for (const table of workspaceOwnedTables) {
      const metadata = metadataDataSource.entityMetadatas.find(
        (entity) => entity.tableName === table,
      );
      assert.ok(metadata, `${table} must have TypeORM metadata`);
      assert.ok(
        metadata.columns.some((column) => column.databaseName === "workspace_id"),
        `${table} must have an explicit workspace_id column`,
      );
    }

    const statements: string[] = [];
    await new WorkspaceModelBaseline2026071500001().up({
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner);
    const sql = statements.join("\n");
    assert.doesNotMatch(sql, /ROW LEVEL SECURITY/i);
    assert.doesNotMatch(sql, /CREATE POLICY/i);
    assert.doesNotMatch(sql, /hermes_workspace_app/i);
    assert.doesNotMatch(sql, /current_setting|set_config/i);
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
