import type { MigrationInterface, QueryRunner } from "typeorm";
import { WORKSPACE_DATABASE_GUCS } from "../workspace-database.constants.js";

export class AuditLogs2026071700002 implements MigrationInterface {
  name = "AuditLogs2026071700002";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "access_audit_logs"
      ADD COLUMN "scope_type" character varying(24),
      ADD COLUMN "session_id" uuid,
      ADD COLUMN "ip_address" character varying(64),
      ADD COLUMN "user_agent" character varying(500)
    `);
    await queryRunner.query(`
      UPDATE "access_audit_logs"
      SET "scope_type" = CASE
        WHEN "principal_type" = 'platform' THEN 'platform'
        WHEN "permission" LIKE '%:own' THEN 'own'
        ELSE 'workspace'
      END
    `);
    await queryRunner.query(`
      ALTER TABLE "access_audit_logs"
      ALTER COLUMN "scope_type" SET NOT NULL
    `);
    await queryRunner.query(`
      CREATE TABLE "login_audit_logs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "scope_type" character varying(24) NOT NULL,
        "workspace_id" uuid,
        "actor_id" uuid,
        "attempted_email" character varying(160) NOT NULL,
        "result" character varying(16) NOT NULL,
        "failure_code" character varying(120),
        "session_id" uuid,
        "ip_address" character varying(64),
        "user_agent" character varying(500),
        "device_label" character varying(160),
        CONSTRAINT "PK_login_audit_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_login_audit_scope" ON "login_audit_logs" ("scope_type", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_login_audit_workspace" ON "login_audit_logs" ("workspace_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_login_audit_actor" ON "login_audit_logs" ("actor_id", "created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_login_audit_email" ON "login_audit_logs" ("attempted_email", "created_at")`,
    );
    const workspacePredicate = `"workspace_id" = NULLIF(current_setting('${WORKSPACE_DATABASE_GUCS.workspaceId}', true), '')::uuid`;
    await queryRunner.query(
      `ALTER TABLE "login_audit_logs" ENABLE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `ALTER TABLE "login_audit_logs" FORCE ROW LEVEL SECURITY`,
    );
    await queryRunner.query(
      `CREATE POLICY "workspace_isolation_login_audit_logs" ON "login_audit_logs" USING (${workspacePredicate}) WITH CHECK (${workspacePredicate})`,
    );
    await queryRunner.query(
      `GRANT SELECT, INSERT ON "login_audit_logs" TO hermes_workspace_app`,
    );
    await queryRunner.query(
      `REVOKE UPDATE, DELETE ON "access_audit_logs" FROM hermes_workspace_app`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP POLICY IF EXISTS "workspace_isolation_login_audit_logs" ON "login_audit_logs"`,
    );
    await queryRunner.query(`DROP TABLE "login_audit_logs"`);
    await queryRunner.query(
      `GRANT UPDATE, DELETE ON "access_audit_logs" TO hermes_workspace_app`,
    );
    await queryRunner.query(`
      ALTER TABLE "access_audit_logs"
      DROP COLUMN "user_agent",
      DROP COLUMN "ip_address",
      DROP COLUMN "session_id",
      DROP COLUMN "scope_type"
    `);
  }
}
