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

const databaseUrl =
  process.env.POSTGRES_E2E_URL ??
  "postgresql://hermes:hermes_dev_pwd@localhost:5432/hermes-e2e";

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
    await inWorkspace(ids.workspaceA, async (manager) => {
      await manager.getRepository(Ticket).save({
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
        inWorkspace(ids.workspaceA, (manager) =>
          manager.getRepository(Ticket).save({
            assigneeUserId: null,
            conversationId: null,
            participantUserIds: [],
            requesterUserId: ids.userB,
            status: "open",
            subject: "Cross workspace ticket",
            workspaceId: ids.workspaceA,
          }),
        ),
      (error: unknown) => databaseErrorCode(error) === "23503",
    );
  });

  it("restricts workspace-role reads to the current workspace", async () => {
    const visibleIds = await dataSource.transaction(async (manager) => {
      await manager.query("SET LOCAL ROLE hermes_workspace_app");
      await manager.query(
        `SELECT
          set_config('app.workspace_id', $1, true),
          set_config('app.scope_level', 'workspace', true)`,
        [ids.workspaceA],
      );
      const rows = (await manager.query(
        `SELECT "id" FROM "tickets" ORDER BY "id"`,
      )) as Array<{ id: string }>;
      return rows.map((row) => row.id);
    });

    assert.deepEqual(visibleIds, [ids.ticketA]);
  });

  it("isolates login audit rows and keeps audit tables append-only", async () => {
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

    const visibleRows = await dataSource.transaction(async (manager) => {
      await manager.query("SET LOCAL ROLE hermes_workspace_app");
      await manager.query("SELECT set_config('app.workspace_id', $1, true)", [
        ids.workspaceA,
      ]);
      return manager.query(
        `SELECT "workspace_id", "attempted_email" FROM "login_audit_logs" ORDER BY "attempted_email"`,
      );
    });

    assert.deepEqual(visibleRows, [
      {
        attempted_email: "user-a@example.com",
        workspace_id: ids.workspaceA,
      },
    ]);

    const [privileges] = await dataSource.query(`
      SELECT
        has_table_privilege('hermes_workspace_app', 'login_audit_logs', 'SELECT') AS "loginSelect",
        has_table_privilege('hermes_workspace_app', 'login_audit_logs', 'INSERT') AS "loginInsert",
        has_table_privilege('hermes_workspace_app', 'login_audit_logs', 'UPDATE') AS "loginUpdate",
        has_table_privilege('hermes_workspace_app', 'login_audit_logs', 'DELETE') AS "loginDelete",
        has_table_privilege('hermes_workspace_app', 'access_audit_logs', 'UPDATE') AS "operationUpdate",
        has_table_privilege('hermes_workspace_app', 'access_audit_logs', 'DELETE') AS "operationDelete"
    `);
    assert.deepEqual(privileges, {
      loginDelete: false,
      loginInsert: true,
      loginSelect: true,
      loginUpdate: false,
      operationDelete: false,
      operationUpdate: false,
    });
  });

  async function seedWorkspace(workspaceId: string, userId: string) {
    const roleId = workspaceId === ids.workspaceA ? ids.roleA : ids.roleB;
    await dataSource.getRepository(Account).save(
      account(userId, `${userId}@example.com`),
    );
    await inWorkspace(workspaceId, async (manager) => {
      await manager.getRepository(Role).save({
        id: roleId,
        isSystem: true,
        label: "Workspace Member",
        name: "workspace-member",
        scope: "workspace",
        workspaceId,
      });
      await manager.getRepository(WorkspaceMembership).save({
        accountId: userId,
        removedAt: null,
        roleId,
        status: "active",
        workspaceId,
      });
    });
  }

  function inWorkspace<T>(
    workspaceId: string,
    work: (manager: any) => Promise<T>,
  ) {
    return dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.workspace_id', $1, true)", [
        workspaceId,
      ]);
      await manager.query(
        "SELECT set_config('app.scope_level', 'workspace', true)",
      );
      return work(manager);
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
