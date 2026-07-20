import type { MigrationInterface, QueryRunner } from "typeorm";
import { TENANT_DATABASE_GUCS } from "../tenant-database.constants.js";

export const ORGANIZATION_RLS_TABLES = {
  roles: "organization_id",
  tickets: "source_organization_id",
  user_organization_roles: "organization_id",
  user_organizations: "organization_id",
} as const;

export class OrganizationScopeRls2026072000002 implements MigrationInterface {
  name = "OrganizationScopeRls2026072000002";

  async up(queryRunner: QueryRunner) {
    for (const [table, organizationColumn] of Object.entries(
      ORGANIZATION_RLS_TABLES,
    )) {
      const predicate = organizationScopePredicate(organizationColumn);
      await queryRunner.query(
        `DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`,
      );
      await queryRunner.query(
        `CREATE POLICY "tenant_isolation_${table}" ON "${table}" USING (${predicate}) WITH CHECK (${predicate})`,
      );
      await queryRunner.query(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      await queryRunner.query(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
  }

  async down(queryRunner: QueryRunner) {
    const tenantPredicate =
      `"tenant_id" = NULLIF(current_setting('${TENANT_DATABASE_GUCS.tenantId}', true), '')::uuid`;
    for (const table of Object.keys(ORGANIZATION_RLS_TABLES)) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "tenant_isolation_${table}" ON "${table}"`,
      );
      await queryRunner.query(
        `CREATE POLICY "tenant_isolation_${table}" ON "${table}" USING (${tenantPredicate}) WITH CHECK (${tenantPredicate})`,
      );
    }
  }
}

function organizationScopePredicate(organizationColumn: string) {
  return [
    `"tenant_id" = NULLIF(current_setting('${TENANT_DATABASE_GUCS.tenantId}', true), '')::uuid`,
    `AND (`,
    `current_setting('${TENANT_DATABASE_GUCS.scopeLevel}', true) = 'tenant'`,
    `OR (`,
    `current_setting('${TENANT_DATABASE_GUCS.scopeLevel}', true) = 'organization'`,
    `AND "${organizationColumn}" = NULLIF(current_setting('${TENANT_DATABASE_GUCS.organizationId}', true), '')::uuid`,
    `)`,
    `)`,
  ].join(" ");
}
