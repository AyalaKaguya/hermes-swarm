import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuditQueryService } from "./audit-query.service.js";

describe("AuditQueryService scope isolation", () => {
  it("adds the trusted workspace id to workspace audit queries", async () => {
    const platformLogin = createRepository();
    const platformAccess = createRepository();
    const service = createService({ platformAccess, platformLogin });

    await service.listLoginLogs("workspace", query());
    await service.listOperationLogs("workspace", query());

    assert.equal(
      platformLogin.builders[0]?.whereClauses[0]?.sql,
      "log.scope_type = :scope",
    );
    assert.deepEqual(
      platformLogin.builders[0]?.whereClauses[1],
      { parameters: { workspaceId: "workspace-a" }, sql: "log.workspace_id = :workspaceId" },
    );
    assert.deepEqual(
      platformAccess.builders[0]?.whereClauses[2],
      { parameters: { workspaceId: "workspace-a" }, sql: "log.workspace_id = :workspaceId" },
    );
    assert.match(
      platformLogin.builders[0]?.joins[0]?.condition ?? "",
      /user_workspace_roles/,
    );
  });

  it("restricts platform operation logs to platform principals", async () => {
    const platformAccess = createRepository();
    const service = createService({ platformAccess });

    await service.listOperationLogs("platform", query());

    assert.equal(
      platformAccess.builders[0]?.whereClauses[0]?.sql,
      "log.principal_type = 'platform'",
    );
  });
});

function createService(
  options: {
    platformAccess?: ReturnType<typeof createRepository>;
    platformLogin?: ReturnType<typeof createRepository>;
  } = {},
) {
  return new AuditQueryService(
    { current: () => ({ workspaceId: "workspace-a" }) } as never,
    (options.platformAccess ?? createRepository()) as never,
    (options.platformLogin ?? createRepository()) as never,
    { find: async () => [] } as never,
    { find: async () => [] } as never,
    { find: async () => [] } as never,
  );
}

function createRepository() {
  const builders: ReturnType<typeof createBuilder>[] = [];
  return {
    builders,
    createQueryBuilder: () => {
      const builder = createBuilder();
      builders.push(builder);
      return builder;
    },
    find: async () => [],
  };
}

function createBuilder() {
  const joins: Array<{ condition: string }> = [];
  const whereClauses: Array<{ parameters?: unknown; sql: string }> = [];
  const builder = {
    addOrderBy: () => builder,
    andWhere: (sql: string, parameters?: unknown) => {
      whereClauses.push({ parameters, sql });
      return builder;
    },
    getManyAndCount: async () => [[], 0] as [unknown[], number],
    leftJoin: (_target: unknown, _alias: string, condition: string) => {
      joins.push({ condition });
      return builder;
    },
    orderBy: () => builder,
    skip: () => builder,
    take: () => builder,
    where: (sql: string, parameters?: unknown) => {
      whereClauses.push({ parameters, sql });
      return builder;
    },
    whereClauses,
    joins,
  };
  return builder;
}

function query() {
  return {
    actorId: null,
    from: null,
    httpMethod: null,
    keyword: null,
    page: 1,
    pageSize: 20,
    permission: null,
    result: null,
    to: null,
  };
}
