import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DataSource } from "typeorm";
import {
  Account,
  Role,
  Ticket,
  Workspace,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { DATABASE_ENTITIES } from "../common/database/database-entities.js";
import { WorkspaceModelBaseline2026071500001 } from "../common/database/migrations/202607150001-WorkspaceModelBaseline.js";
import { AuditLogs2026071700002 } from "../common/database/migrations/202607170002-AuditLogs.js";
import { CredentialVersion2026072000001 } from "../common/database/migrations/2026072000001-CredentialVersion.js";
import { RemoveWorkspaceRls2026072200001 } from "../common/database/migrations/2026072200001-RemoveWorkspaceRls.js";
import { PlatformTicketInboxPermissions2026072300001 } from "../common/database/migrations/2026072300001-PlatformTicketInboxPermissions.js";

const databaseUrl = process.env.POSTGRES_TEST_URL;

if (!databaseUrl) {
  throw new Error(
    "POSTGRES_TEST_URL is required for database e2e tests",
  );
}

const ids = {
  workspaceA: "00000000-0000-4000-8000-000000000001",
  workspaceB: "00000000-0000-4000-8000-000000000002",
  userA: "00000000-0000-4000-8000-000000000101",
  userB: "00000000-0000-4000-8000-000000000102",
  roleA: "00000000-0000-4000-8000-000000000201",
  roleB: "00000000-0000-4000-8000-000000000202",
  ticketA: "00000000-0000-4000-8000-000000000301",
};

describe("workspace database baseline e2e", { concurrency: false }, () => {
  let dataSource: DataSource;

  before(async () => {
    dataSource = new DataSource({
      type: "postgres",
      url: databaseUrl,
      entities: [...DATABASE_ENTITIES],
      migrations: [
        WorkspaceModelBaseline2026071500001,
        AuditLogs2026071700002,
        CredentialVersion2026072000001,
        RemoveWorkspaceRls2026072200001,
        PlatformTicketInboxPermissions2026072300001,
      ],
      migrationsRun: false,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query("DROP SCHEMA IF EXISTS public CASCADE");
    await dataSource.query("CREATE SCHEMA public");
    await dataSource.runMigrations();

    await dataSource.getRepository(Workspace).save([
      {
        id: ids.workspaceA,
        name: "Workspace A",
        slug: "workspace-a",
        status: "active",
        subdomain: null,
      },
      {
        id: ids.workspaceB,
        name: "Workspace B",
        slug: "workspace-b",
        status: "active",
        subdomain: null,
      },
    ]);
    await seedWorkspace(ids.workspaceA, ids.userA);
    await seedWorkspace(ids.workspaceB, ids.userB);
    await dataSource.getRepository(Ticket).save({
      assigneeUserId: null,
      conversationId: null,
      id: ids.ticketA,
      participantUserIds: [ids.userA],
      requesterUserId: ids.userA,
      status: "open",
      subject: "Workspace A ticket",
      workspaceId: ids.workspaceA,
    });
  });

  after(async () => {
    await dataSource?.destroy();
  });

  it("keeps normalized email unique at the global account boundary", async () => {
    assert.equal(await dataSource.getRepository(Account).count(), 2);
    await assert.rejects(
      () =>
        dataSource.getRepository(Account).save(
          account(
            "00000000-0000-4000-8000-000000000103",
            `${ids.userA}@example.com`,
          ),
        ),
      (error: unknown) => databaseErrorCode(error) === "23505",
    );
  });

  it("rejects business references to members from another workspace", async () => {
    await assert.rejects(
      () =>
        dataSource.getRepository(Ticket).save({
          assigneeUserId: null,
          conversationId: null,
          participantUserIds: [],
          requesterUserId: ids.userB,
          status: "open",
          subject: "Cross workspace ticket",
          workspaceId: ids.workspaceA,
        }),
      (error: unknown) => databaseErrorCode(error) === "23503",
    );
  });

  it("creates the baseline without PostgreSQL RLS", async () => {
    const tables = [
      "access_audit_logs",
      "conversation_messages",
      "conversation_participants",
      "conversations",
      "custom_smtp",
      "email_sent",
      "email_templates",
      "integration_tokens",
      "invites",
      "login_audit_logs",
      "role_permissions",
      "roles",
      "ticket_messages",
      "tickets",
      "user_notifications",
      "user_workspace_roles",
      "users",
      "workspace_settings",
      "workspaces",
    ];
    const tableSecurity = (await dataSource.query(
      `
        SELECT
          relname AS "tableName",
          relforcerowsecurity AS "forceRowSecurity",
          relrowsecurity AS "rowSecurity"
        FROM pg_class
        WHERE relnamespace = 'public'::regnamespace
          AND relname = ANY($1)
        ORDER BY relname
      `,
      [tables],
    )) as Array<{
      forceRowSecurity: boolean;
      rowSecurity: boolean;
      tableName: string;
    }>;
    assert.deepEqual(
      tableSecurity,
      [...tables]
        .sort()
        .map((tableName) => ({
          forceRowSecurity: false,
          rowSecurity: false,
          tableName,
        })),
    );

    const policies = await dataSource.query(
      `
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = ANY($1)
      `,
      [tables],
    );
    assert.deepEqual(policies, []);
  });

  it("cleans an upgraded legacy policy without touching rows, indexes, constraints, or migration history", async () => {
    const beforeRows = await dataSource.query(
      `SELECT count(*)::int AS count FROM "tickets"`,
    );
    const beforeHistory = await dataSource.query(
      `SELECT name FROM "migrations" ORDER BY id`,
    );
    const indexBefore = await dataSource.query(
      `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'IDX_tickets_workspace_status_updated'`,
    );
    const constraintBefore = await dataSource.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'FK_tickets_workspace_requester'`,
    );

    await dataSource.query(
      `ALTER TABLE "public"."tickets" ENABLE ROW LEVEL SECURITY`,
    );
    await dataSource.query(
      `ALTER TABLE "public"."tickets" FORCE ROW LEVEL SECURITY`,
    );
    await dataSource.query(
      `CREATE POLICY "workspace_isolation_tickets" ON "public"."tickets" USING (true) WITH CHECK (true)`,
    );

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    try {
      await new RemoveWorkspaceRls2026072200001().up(runner);
    } finally {
      await runner.release();
    }

    assert.deepEqual(
      await dataSource.query(`SELECT count(*)::int AS count FROM "tickets"`),
      beforeRows,
    );
    assert.deepEqual(
      await dataSource.query(`SELECT name FROM "migrations" ORDER BY id`),
      beforeHistory,
    );
    assert.deepEqual(
      await dataSource.query(
        `SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'IDX_tickets_workspace_status_updated'`,
      ),
      indexBefore,
    );
    assert.deepEqual(
      await dataSource.query(
        `SELECT 1 FROM pg_constraint WHERE conname = 'FK_tickets_workspace_requester'`,
      ),
      constraintBefore,
    );
    assert.deepEqual(
      await dataSource.query(
        `SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'tickets'`,
      ),
      [],
    );
    assert.deepEqual(
      await dataSource.query(
        `SELECT relforcerowsecurity AS "forceRowSecurity", relrowsecurity AS "rowSecurity"
           FROM pg_class
          WHERE oid = 'public.tickets'::regclass`,
      ),
      [{ forceRowSecurity: false, rowSecurity: false }],
    );
  });

  it("stores login audit rows without an implicit database filter", async () => {
    await dataSource.query(
      `
        INSERT INTO "login_audit_logs"
          ("workspace_id", "scope_type", "attempted_email", "result")
        VALUES
          ($1, 'workspace', 'user-a@example.com', 'success'),
          ($2, 'workspace', 'user-b@example.com', 'failed'),
          (NULL, 'platform', 'platform@example.com', 'success')
      `,
      [ids.workspaceA, ids.workspaceB],
    );

    const rows = await dataSource.query(
      `SELECT "workspace_id", "attempted_email" FROM "login_audit_logs" ORDER BY "attempted_email"`,
    );

    assert.deepEqual(rows, [
      {
        attempted_email: "platform@example.com",
        workspace_id: null,
      },
      {
        attempted_email: "user-a@example.com",
        workspace_id: ids.workspaceA,
      },
      {
        attempted_email: "user-b@example.com",
        workspace_id: ids.workspaceB,
      },
    ]);
  });

  async function seedWorkspace(workspaceId: string, userId: string) {
    const roleId = workspaceId === ids.workspaceA ? ids.roleA : ids.roleB;
    await dataSource.getRepository(Account).save(
      account(userId, `${userId}@example.com`),
    );
    await dataSource.getRepository(Role).save({
      id: roleId,
      isSystem: true,
      label: "Workspace Member",
      name: "workspace-member",
      scope: "workspace",
      workspaceId,
    });
    await dataSource.getRepository(WorkspaceMembership).save({
      accountId: userId,
      removedAt: null,
      roleId,
      status: "active",
      workspaceId,
    });
  }
});

function account(id: string, email: string) {
  return {
    displayName: "Shared User",
    email,
    emailVerified: true,
    id,
    preferredLanguage: "zh-Hans" as const,
    status: "active" as const,
    type: "user" as const,
  };
}

function databaseErrorCode(error: unknown) {
  return (error as { driverError?: { code?: string } })?.driverError?.code;
}
