import type { MigrationInterface, QueryRunner } from "typeorm";

const HERMES_RLS_TARGETS = [
  ["access_audit_logs", "workspace_isolation_access_audit_logs"],
  ["conversation_messages", "workspace_isolation_conversation_messages"],
  ["conversation_participants", "workspace_isolation_conversation_participants"],
  ["conversations", "workspace_isolation_conversations"],
  ["custom_smtp", "workspace_isolation_custom_smtp"],
  ["email_sent", "workspace_isolation_email_sent"],
  ["email_templates", "workspace_isolation_email_templates"],
  ["integration_tokens", "workspace_isolation_integration_tokens"],
  ["invites", "workspace_isolation_invites"],
  ["login_audit_logs", "workspace_isolation_login_audit_logs"],
  ["role_permissions", "workspace_isolation_role_permissions"],
  ["roles", "workspace_isolation_roles"],
  ["user_notifications", "workspace_isolation_user_notifications"],
  ["user_workspace_roles", "workspace_isolation_user_workspace_roles"],
  ["users", "workspace_accounts_read"],
  ["workspace_settings", "workspace_isolation_workspace_settings"],
  ["workspaces", "workspace_isolation_workspaces"],
  ["ticket_messages", "workspace_isolation_ticket_messages"],
  ["tickets", "workspace_isolation_tickets"],
] as const;

type UnexpectedPolicy = {
  policyname: string;
  schemaname: string;
  tablename: string;
};

/**
 * Removes the historic database-enforced workspace isolation. The application's
 * explicit workspace predicates are the sole tenant boundary after this point.
 */
export class RemoveWorkspaceRls2026072200001 implements MigrationInterface {
  name = "RemoveWorkspaceRls2026072200001";

  async up(queryRunner: QueryRunner): Promise<void> {
    const unexpectedPolicies = (await queryRunner.query(
      `
        WITH known_policies(table_name, policy_name) AS (
          VALUES ${HERMES_RLS_TARGETS.map(
            ([table, policy]) => `('${table}', '${policy}')`,
          ).join(", ")}
        ),
        target_tables(table_name) AS (
          VALUES ${HERMES_RLS_TARGETS.map(([table]) => `('${table}')`).join(", ")}
        )
        SELECT policy.schemaname, policy.tablename, policy.policyname
        FROM pg_policies AS policy
        INNER JOIN target_tables AS target
          ON target.table_name = policy.tablename
        LEFT JOIN known_policies AS known
          ON known.table_name = policy.tablename
          AND known.policy_name = policy.policyname
        WHERE policy.schemaname = 'public'
          AND known.policy_name IS NULL
        ORDER BY policy.tablename, policy.policyname
      `,
    )) as UnexpectedPolicy[];

    if (unexpectedPolicies.length > 0) {
      const names = unexpectedPolicies
        .map(
          ({ schemaname, tablename, policyname }) =>
            `${schemaname}.${tablename}.${policyname}`,
        )
        .join(", ");
      throw new Error(
        `Cannot remove Workspace RLS while unknown policies exist: ${names}. Review them manually before retrying the migration.`,
      );
    }

    for (const [table, policy] of HERMES_RLS_TARGETS) {
      await queryRunner.query(
        `DROP POLICY IF EXISTS "${policy}" ON "public"."${table}"`,
      );
      await queryRunner.query(
        `ALTER TABLE "public"."${table}" NO FORCE ROW LEVEL SECURITY`,
      );
      await queryRunner.query(
        `ALTER TABLE "public"."${table}" DISABLE ROW LEVEL SECURITY`,
      );
    }

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hermes_workspace_app') THEN
          REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM hermes_workspace_app;
          REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM hermes_workspace_app;
          REVOKE ALL PRIVILEGES ON SCHEMA public FROM hermes_workspace_app;
        END IF;
      END $$;
    `);
  }

  async down(): Promise<void> {
    throw new Error(
      "RemoveWorkspaceRls2026072200001 cannot be rolled back safely. Restore a database backup or author a new, reviewed security migration.",
    );
  }
}
