import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { DataSource } from "typeorm";
import { Organization, Tenant, Ticket, User } from "@hermes-swarm/core";
import { DATABASE_ENTITIES } from "../common/database/database-entities.js";
import { WorkspaceModelBaseline2026071500001 } from "../common/database/migrations/202607150001-WorkspaceModelBaseline.js";

const databaseUrl =
  process.env.POSTGRES_E2E_URL ??
  "postgresql://hermes:hermes_dev_pwd@localhost:5432/hermes-e2e";

const ids = {
  organizationA: "00000000-0000-4000-8000-000000000201",
  organizationB: "00000000-0000-4000-8000-000000000202",
  tenantA: "00000000-0000-4000-8000-000000000001",
  tenantB: "00000000-0000-4000-8000-000000000002",
  userA: "00000000-0000-4000-8000-000000000101",
  userB: "00000000-0000-4000-8000-000000000102",
};

describe("workspace database baseline e2e", { concurrency: false }, () => {
  let dataSource: DataSource;

  before(async () => {
    dataSource = new DataSource({
      type: "postgres",
      url: databaseUrl,
      entities: [...DATABASE_ENTITIES],
      migrations: [WorkspaceModelBaseline2026071500001],
      migrationsRun: false,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query("DROP SCHEMA IF EXISTS public CASCADE");
    await dataSource.query("CREATE SCHEMA public");
    await dataSource.runMigrations();

    await dataSource.getRepository(Tenant).save([
      { id: ids.tenantA, name: "Workspace A", slug: "workspace-a", status: "active", subdomain: null },
      { id: ids.tenantB, name: "Workspace B", slug: "workspace-b", status: "active", subdomain: null },
    ]);
    await seedTenant(ids.tenantA, ids.userA, ids.organizationA);
    await seedTenant(ids.tenantB, ids.userB, ids.organizationB);
  });

  after(async () => {
    await dataSource?.destroy();
  });

  it("allows the same normalized email in different tenants but not twice in one tenant", async () => {
    assert.equal(await dataSource.getRepository(User).count(), 2);
    await assert.rejects(
      () =>
        inTenant(ids.tenantA, (manager) =>
          manager.getRepository(User).save(user("00000000-0000-4000-8000-000000000103", ids.tenantA)),
        ),
      (error: unknown) => databaseErrorCode(error) === "23505",
    );
  });

  it("enforces one active root organization per tenant", async () => {
    await assert.rejects(
      () =>
        inTenant(ids.tenantA, (manager) =>
          manager.getRepository(Organization).save({
            id: "00000000-0000-4000-8000-000000000203",
            name: "Second root",
            parentOrganizationId: null,
            slug: "second-root",
            status: "active",
            tenantId: ids.tenantA,
          }),
        ),
      (error: unknown) => databaseErrorCode(error) === "23505",
    );
  });

  it("rejects a ticket whose source organization belongs to another tenant", async () => {
    await assert.rejects(
      () =>
        inTenant(ids.tenantA, (manager) =>
          manager.getRepository(Ticket).save({
            assigneeUserId: null,
            conversationId: null,
            participantUserIds: [],
            requesterUserId: ids.userA,
            sourceOrganizationId: ids.organizationB,
            status: "open",
            subject: "Cross tenant ticket",
            tenantId: ids.tenantA,
          }),
        ),
      (error: unknown) => databaseErrorCode(error) === "23503",
    );
  });

  async function seedTenant(tenantId: string, userId: string, organizationId: string) {
    await inTenant(tenantId, async (manager) => {
      await manager.getRepository(User).save(user(userId, tenantId));
      await manager.getRepository(Organization).save({
        id: organizationId,
        name: `Organization ${tenantId.at(-1)}`,
        parentOrganizationId: null,
        slug: `organization-${tenantId.at(-1)}`,
        status: "active",
        tenantId,
      });
    });
  }

  function inTenant<T>(tenantId: string, work: (manager: any) => Promise<T>) {
    return dataSource.transaction(async (manager) => {
      await manager.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      return work(manager);
    });
  }
});

function user(id: string, tenantId: string) {
  return {
    displayName: "Shared User",
    email: "shared@example.com",
    emailVerified: true,
    id,
    preferredLanguage: "zh-Hans" as const,
    status: "active" as const,
    tenantId,
    type: "user" as const,
  };
}

function databaseErrorCode(error: unknown) {
  return (error as { driverError?: { code?: string } })?.driverError?.code;
}
