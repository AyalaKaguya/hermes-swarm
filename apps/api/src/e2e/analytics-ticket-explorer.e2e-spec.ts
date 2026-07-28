import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import {
  ANALYTICS_QUERY_VERSION,
  AnalysisQuerySchema,
} from "@hermes-swarm/api-contracts/analytics";
import {
  Account,
  Role,
  Ticket,
  Workspace,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { DataSource } from "typeorm";
import { DATABASE_ENTITIES } from "../common/database/database-entities.js";
import { WorkspaceContextService } from "../common/database/workspace-context.service.js";
import { WorkspaceModelBaseline2026071500001 } from "../common/database/migrations/202607150001-WorkspaceModelBaseline.js";
import { CanonicalRuntimePreferences2026071700001 } from "../common/database/migrations/202607170001-CanonicalRuntimePreferences.js";
import { AuditLogs2026071700002 } from "../common/database/migrations/202607170002-AuditLogs.js";
import { CredentialVersion2026072000001 } from "../common/database/migrations/2026072000001-CredentialVersion.js";
import { RemoveWorkspaceRls2026072200001 } from "../common/database/migrations/2026072200001-RemoveWorkspaceRls.js";
import { PlatformTicketInboxPermissions2026072300001 } from "../common/database/migrations/2026072300001-PlatformTicketInboxPermissions.js";
import { ObjectStorageFiles2026072400001 } from "../common/database/migrations/2026072400001-ObjectStorageFiles.js";
import { ModelProviderCatalog2026072500001 } from "../common/database/migrations/2026072500001-ModelProviderCatalog.js";
import { AnalyticsTicketExplorerPermissions2026072500002 } from "../common/database/migrations/2026072500002-AnalyticsTicketExplorerPermissions.js";
import { AnalyticsQueryGateway } from "../domains/analytics/analytics-query.gateway.js";
import type { AnalyticsAuthorizationContext } from "../domains/analytics/analytics-source.adapter.js";
import { AnalyticsSourceRegistry } from "../domains/analytics/analytics-source.registry.js";
import { SupportTicketsAnalyticsAdapter } from "../domains/analytics/support-tickets-analytics.adapter.js";
import {
  SUPPORT_TICKETS_QUERY_PERMISSION,
  SUPPORT_TICKETS_SOURCE_REVISION,
} from "../domains/analytics/support-tickets-analytics.constants.js";

const databaseUrl = process.env.POSTGRES_TEST_URL;

if (!databaseUrl) {
  throw new Error("POSTGRES_TEST_URL is required for analytics e2e tests");
}

const ids = {
  accountA: "10000000-0000-4000-8000-000000000001",
  accountB: "10000000-0000-4000-8000-000000000002",
  roleA: "20000000-0000-4000-8000-000000000001",
  roleB: "20000000-0000-4000-8000-000000000002",
  workspaceA: "30000000-0000-4000-8000-000000000001",
  workspaceB: "30000000-0000-4000-8000-000000000002",
} as const;

describe("support ticket analytics e2e", { concurrency: false }, () => {
  let adapter: SupportTicketsAnalyticsAdapter;
  let dataSource: DataSource;
  let gateway: AnalyticsQueryGateway;
  let workspaceContext: WorkspaceContextService;

  before(async () => {
    dataSource = new DataSource({
      type: "postgres",
      url: databaseUrl,
      entities: [...DATABASE_ENTITIES],
      migrations: [
        WorkspaceModelBaseline2026071500001,
        CanonicalRuntimePreferences2026071700001,
        AuditLogs2026071700002,
        CredentialVersion2026072000001,
        RemoveWorkspaceRls2026072200001,
        PlatformTicketInboxPermissions2026072300001,
        ObjectStorageFiles2026072400001,
        ModelProviderCatalog2026072500001,
        AnalyticsTicketExplorerPermissions2026072500002,
      ],
      migrationsRun: false,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query("DROP SCHEMA IF EXISTS public CASCADE");
    await dataSource.query("CREATE SCHEMA public");
    await dataSource.runMigrations();

    await dataSource.getRepository(Workspace).save([
      workspace(ids.workspaceA, "analytics-a"),
      workspace(ids.workspaceB, "analytics-b"),
    ]);
    await seedWorkspace(ids.workspaceA, ids.accountA, ids.roleA, "workspace-owner");
    await seedWorkspace(ids.workspaceB, ids.accountB, ids.roleB, "workspace-admin");
    const permissionRunner = dataSource.createQueryRunner();
    await permissionRunner.connect();
    try {
      await new AnalyticsTicketExplorerPermissions2026072500002().up(
        permissionRunner,
      );
    } finally {
      await permissionRunner.release();
    }

    await dataSource.getRepository(Ticket).save([
      ticket(ids.workspaceA, ids.accountA, "open", "Workspace A ticket 1"),
      ticket(ids.workspaceA, ids.accountA, "open", "Workspace A ticket 2"),
      ticket(ids.workspaceB, ids.accountB, "closed", "Workspace B ticket"),
    ]);

    const registry = new AnalyticsSourceRegistry();
    adapter = new SupportTicketsAnalyticsAdapter(
      dataSource.getRepository(Ticket),
      registry,
    );
    adapter.onModuleInit();
    workspaceContext = new WorkspaceContextService();
    gateway = new AnalyticsQueryGateway(workspaceContext, registry);
  });

  after(async () => {
    adapter?.onModuleDestroy();
    await dataSource?.destroy();
  });

  it("returns only rows belonging to the trusted workspace", async () => {
    const query = AnalysisQuerySchema.parse({
      groupBy: ["status"],
      measures: [{ aggregation: "count", as: "ticketCount" }],
      schemaVersion: ANALYTICS_QUERY_VERSION,
      select: ["status"],
      sort: [{ direction: "desc", field: "ticketCount" }],
      sourceKey: "support.tickets",
      sourceRevision: SUPPORT_TICKETS_SOURCE_REVISION,
    });

    const workspaceAResult = await runInWorkspace(ids.workspaceA, ids.accountA, query);
    const workspaceBResult = await runInWorkspace(ids.workspaceB, ids.accountB, query);

    assert.deepEqual(workspaceAResult.rows, [{ status: "open", ticketCount: 2 }]);
    assert.deepEqual(workspaceBResult.rows, [{ status: "closed", ticketCount: 1 }]);
    assert.notEqual(
      workspaceAResult.lineage.policyDigest,
      workspaceBResult.lineage.policyDigest,
    );
  });

  it("backfills analytics permissions only to existing owner and admin roles", async () => {
    const rows = (await dataSource.query(
      `
        SELECT "role"."workspace_id" AS "workspaceId", "permission"."code"
        FROM "role_permissions" AS "grant"
        INNER JOIN "roles" AS "role" ON "role"."id" = "grant"."role_id"
        INNER JOIN "permissions" AS "permission"
          ON "permission"."id" = "grant"."permission_id"
        WHERE "permission"."code" LIKE 'analytics.%'
           OR "permission"."code" = 'page.analytics.access:workspace'
        ORDER BY "role"."workspace_id", "permission"."code"
      `,
    )) as Array<{ code: string; workspaceId: string }>;

    assert.equal(rows.length, 6);
    assert.deepEqual(new Set(rows.map((row) => row.workspaceId)), new Set([
      ids.workspaceA,
      ids.workspaceB,
    ]));
    assert.ok(rows.every((row) => row.code.includes("analytics")));
  });

  async function runInWorkspace(
    workspaceId: string,
    actorId: string,
    query: ReturnType<typeof AnalysisQuerySchema.parse>,
  ) {
    const authorization = {
      actorId,
      locale: "zh-Hans",
      permissions: new Set([SUPPORT_TICKETS_QUERY_PERMISSION]),
      principalType: "workspace",
      requestId: `request-${workspaceId}`,
      timeZone: "Asia/Hong_Kong",
    } satisfies AnalyticsAuthorizationContext;
    return workspaceContext.run(
      { scopeLevel: "workspace", workspaceId },
      () => gateway.execute(query, authorization),
    );
  }

  async function seedWorkspace(
    workspaceId: string,
    accountId: string,
    roleId: string,
    roleName: "workspace-admin" | "workspace-owner",
  ) {
    await dataSource.getRepository(Account).save({
      displayName: roleName,
      email: `${accountId}@example.com`,
      emailVerified: true,
      id: accountId,
      preferredLanguage: "zh-Hans",
      status: "active",
      type: "user",
    });
    await dataSource.getRepository(Role).save({
      id: roleId,
      isSystem: true,
      label: roleName,
      name: roleName,
      scope: "workspace",
      workspaceId,
    });
    await dataSource.getRepository(WorkspaceMembership).save({
      accountId,
      removedAt: null,
      roleId,
      status: "active",
      workspaceId,
    });
  }
});

function workspace(id: string, slug: string) {
  return {
    id,
    name: slug,
    slug,
    status: "active" as const,
    subdomain: null,
  };
}

function ticket(
  workspaceId: string,
  requesterUserId: string,
  status: "closed" | "open",
  subject: string,
) {
  return {
    assigneeUserId: null,
    conversationId: null,
    participantUserIds: [requesterUserId],
    requesterUserId,
    status,
    subject,
    workspaceId,
  };
}
