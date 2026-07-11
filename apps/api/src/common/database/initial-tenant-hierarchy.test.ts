import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TenantOwnedBaseEntity } from "@hermes-swarm/core";
import { getMetadataArgsStorage, type QueryRunner } from "typeorm";
import migrationDataSource from "./migration-data-source.js";
import { TENANT_DATABASE_GUCS } from "./tenant-database.constants.js";
import {
  InitialTenantHierarchy202607110001,
  TENANT_RLS_GAPS,
  TENANT_RLS_TABLES,
} from "./migrations/202607110001-InitialTenantHierarchy.js";

function createTableStatement(sql: string, table: string): string {
  const statement = sql.match(
    new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n\\s*\\);`),
  )?.[0];
  assert.ok(statement, `Expected migration SQL for ${table}`);
  return statement;
}

describe("initial tenant hierarchy migration", () => {
  it("builds TypeORM metadata for the complete migration datasource", async () => {
    await (
      migrationDataSource as unknown as { buildMetadatas(): Promise<void> }
    ).buildMetadatas();

    assert.ok(
      migrationDataSource.entityMetadatas.some(
        (metadata) => metadata.tableName === "tenants",
      ),
    );
    assert.ok(
      migrationDataSource.entityMetadatas.some(
        (metadata) => metadata.tableName === "platform_email_templates",
      ),
    );
    assert.ok(
      migrationDataSource.entityMetadatas.some(
        (metadata) => metadata.tableName === "platform_smtp",
      ),
    );
    assert.ok(
      migrationDataSource.entityMetadatas.some(
        (metadata) => metadata.tableName === "platform_settings",
      ),
    );
    assert.equal(
      migrationDataSource.entityMetadatas.some(
        (metadata) => metadata.tableName === "platform_members",
      ),
      false,
      "PlatformUser replaces the legacy global-User membership bridge",
    );
  });

  it("covers every decorated TenantOwnedBaseEntity with an RLS policy", () => {
    const tenantOwnedTables = getMetadataArgsStorage()
      .tables.filter((table) => {
        if (typeof table.target !== "function") return false;
        return table.target.prototype instanceof TenantOwnedBaseEntity;
      })
      .map((table) => table.name)
      .filter((name): name is string => Boolean(name))
      .sort();

    assert.deepEqual(
      [...TENANT_RLS_TABLES].sort(),
      tenantOwnedTables,
      "Add every new tenant-owned entity table to the migration RLS manifest",
    );
  });

  it("enables and forces RLS with fail-closed tenant policies", async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner;

    await new InitialTenantHierarchy202607110001().up(queryRunner);
    const sql = statements.join("\n");

    for (const table of TENANT_RLS_TABLES) {
      assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
      assert.match(sql, new RegExp(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`));
      assert.match(sql, new RegExp(`tenant_isolation_${table}`));
    }
    assert.match(sql, /current_setting\('app\.tenant_id', true\)/);
    assert.match(sql, /tenant_id uuid NOT NULL/);
    assert.match(sql, /CREATE TABLE platform_email_templates \(/);
    assert.match(sql, /uq_platform_email_templates_name_language UNIQUE \(name, language_code\)/);
    assert.match(sql, /CREATE TABLE platform_smtp \(/);
    assert.match(sql, /chk_platform_smtp_port CHECK \(port BETWEEN 1 AND 65535\)/);
    assert.match(sql, /CREATE TABLE platform_settings \(/);
    assert.match(sql, /uq_platform_settings_name UNIQUE \(name\)/);
    assert.match(sql, /CREATE ROLE hermes_tenant_app LOGIN [^;]*NOBYPASSRLS/);
    assert.match(sql, /ALTER TABLE tenants FORCE ROW LEVEL SECURITY/);
    assert.match(sql, /CREATE POLICY tenant_isolation_tenants ON tenants/);
    assert.match(sql, /\(id = NULLIF\(current_setting\('app\.tenant_id', true\), ''\)::uuid\)/);
    assert.doesNotMatch(sql, /tenant_isolation_platform_email_templates/);
    assert.doesNotMatch(sql, /tenant_isolation_platform_smtp/);
    assert.doesNotMatch(sql, /CREATE TABLE platform_members/);
    assert.match(
      sql,
      new RegExp(`current_setting\\('${TENANT_DATABASE_GUCS.tenantId}'`),
    );
  });

  it("enforces organization-consistent department scopes with composite foreign keys", async () => {
    const statements: string[] = [];
    const queryRunner = {
      query: async (sql: string) => {
        statements.push(sql);
        return undefined;
      },
    } as unknown as QueryRunner;

    await new InitialTenantHierarchy202607110001().up(queryRunner);
    const sql = statements.join("\n");

    const departments = createTableStatement(sql, "departments");
    assert.match(departments, /UNIQUE \(tenant_id, organization_id, id\)/);

    for (const table of ["roles", "conversations", "tickets", "integration_tokens"]) {
      const statement = createTableStatement(sql, table);
      assert.match(
        statement,
        /FOREIGN KEY \(tenant_id, organization_id, department_id\) REFERENCES departments\(tenant_id, organization_id, id\) ON DELETE RESTRICT/,
        `${table} must bind a department to its tenant and organization`,
      );
    }

    const roles = createTableStatement(sql, "roles");
    assert.match(roles, /UNIQUE \(tenant_id, organization_id, id\)/);
    assert.match(roles, /UNIQUE \(tenant_id, organization_id, department_id, id\)/);

    const userDepartments = createTableStatement(sql, "user_departments");
    assert.match(
      userDepartments,
      /UNIQUE \(tenant_id, organization_id, department_id, id\)/,
    );

    const userOrganizationRoles = createTableStatement(sql, "user_organization_roles");
    assert.match(
      userOrganizationRoles,
      /organization_id uuid NOT NULL, membership_id uuid NOT NULL, role_id uuid NOT NULL/,
    );
    assert.match(
      userOrganizationRoles,
      /FOREIGN KEY \(tenant_id, organization_id, membership_id\) REFERENCES user_organizations\(tenant_id, organization_id, id\) ON DELETE CASCADE/,
    );
    assert.match(
      userOrganizationRoles,
      /FOREIGN KEY \(tenant_id, organization_id, role_id\) REFERENCES roles\(tenant_id, organization_id, id\) ON DELETE CASCADE/,
    );

    const userDepartmentRoles = createTableStatement(sql, "user_department_roles");
    assert.match(
      userDepartmentRoles,
      /organization_id uuid NOT NULL, department_id uuid NOT NULL/,
    );
    assert.match(
      userDepartmentRoles,
      /FOREIGN KEY \(tenant_id, organization_id, department_id, user_department_id\) REFERENCES user_departments\(tenant_id, organization_id, department_id, id\) ON DELETE CASCADE/,
    );
    assert.match(
      userDepartmentRoles,
      /FOREIGN KEY \(tenant_id, organization_id, department_id, role_id\) REFERENCES roles\(tenant_id, organization_id, department_id, id\) ON DELETE CASCADE/,
    );
  });

  it("has no remaining tenant-owned RLS gaps", () => {
    assert.deepEqual([...TENANT_RLS_GAPS], []);
  });
});
