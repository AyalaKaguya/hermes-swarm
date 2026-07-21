import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AccessAuditLog, LoginAuditLog } from "@hermes-swarm/core";
import { AuditQueryService } from "./audit-query.service.js";

describe("AuditQueryService scope isolation", () => {
  it("uses the RLS workspace repository for workspace logs", async () => {
    const targets: unknown[] = [];
    const workspaceRepository = createRepository();
    const service = createService({
      workspaceContext: {
        repository: (target: unknown) => {
          targets.push(target);
          return workspaceRepository;
        },
      },
    });

    await service.listLoginLogs("workspace", query());
    await service.listOperationLogs("workspace", query());

    assert.equal(targets.includes(LoginAuditLog), true);
    assert.equal(targets.includes(AccessAuditLog), true);
    assert.equal(
      workspaceRepository.builders[0]?.whereClauses[0]?.sql,
      "log.scope_type = :scope",
    );
    assert.match(
      workspaceRepository.builders[1]?.whereClauses[0]?.sql ?? "",
      /workspace.*integration/,
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
    workspaceContext?: { repository: (target: unknown) => unknown };
  } = {},
) {
  return new AuditQueryService(
    (options.workspaceContext ?? {
      repository: () => createRepository(),
    }) as never,
    (options.platformAccess ?? createRepository()) as never,
    createRepository() as never,
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
  const whereClauses: Array<{ parameters?: unknown; sql: string }> = [];
  const builder = {
    addOrderBy: () => builder,
    andWhere: (sql: string, parameters?: unknown) => {
      whereClauses.push({ parameters, sql });
      return builder;
    },
    getManyAndCount: async () => [[], 0] as [unknown[], number],
    leftJoin: () => builder,
    orderBy: () => builder,
    skip: () => builder,
    take: () => builder,
    where: (sql: string, parameters?: unknown) => {
      whereClauses.push({ parameters, sql });
      return builder;
    },
    whereClauses,
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
