import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_QUERY_VERSION,
  AnalysisQuerySchema,
} from "@hermes-swarm/api-contracts/analytics";
import { Ticket } from "@hermes-swarm/core";
import {
  SUPPORT_TICKETS_QUERY_POLICY_REVISION,
  SUPPORT_TICKETS_QUERY_SOURCE_REVISION,
  analyticsDigest,
} from "@hermes-swarm/core/analytics";
import type { DataSource, EntityManager, Repository } from "typeorm";
import {
  AnalyticsQueryRunHandlerError,
  type AuthorizedAnalysisQueryRun,
} from "./analytics-query-run.types.js";
import { SupportTicketsQueryExecutor } from "./support-tickets-query.executor.js";

const QUERY = AnalysisQuerySchema.parse({
  schemaVersion: ANALYTICS_QUERY_VERSION,
  select: ["status"],
  sourceKey: "support.tickets",
  sourceRevision: SUPPORT_TICKETS_QUERY_SOURCE_REVISION,
});

const RUN = Object.freeze({
  actorId: "account-a",
  integrationTokenId: null,
  locale: "zh-Hans",
  policyRevision: SUPPORT_TICKETS_QUERY_POLICY_REVISION,
  principalType: "workspace",
  query: QUERY,
  queryDigest: analyticsDigest(QUERY),
  requestId: "request-a",
  sourceKey: QUERY.sourceKey,
  sourceRevision: QUERY.sourceRevision,
  timeZone: "Asia/Hong_Kong",
  workspaceId: "workspace-a",
}) satisfies AuthorizedAnalysisQueryRun;

describe("SupportTicketsQueryExecutor", () => {
  it("runs PostgreSQL analytics inside the fixed statement budget", async () => {
    const state = createState([{ status: "open" }]);

    const result = await state.executor.execute(
      RUN,
      new AbortController().signal,
    );

    assert.deepEqual(state.statements, [
      "SET LOCAL statement_timeout = '10000ms'",
    ]);
    assert.equal(state.transactions, 1);
    assert.deepEqual(result.rows, [{ status: "open" }]);
  });

  it("maps PostgreSQL statement cancellation to a non-retryable timeout", async () => {
    const state = createState([], {
      code: "57014",
      message: "canceling statement due to statement timeout",
    });

    await assert.rejects(
      state.executor.execute(RUN, new AbortController().signal),
      (error: unknown) => {
        assert.ok(error instanceof AnalyticsQueryRunHandlerError);
        assert.equal(error.code, "ANALYTICS_QUERY_TIMEOUT");
        assert.equal(error.retryable, false);
        return true;
      },
    );
  });
});

function createState(
  rows: readonly Record<string, unknown>[],
  queryError?: unknown,
) {
  const statements: string[] = [];
  let transactions = 0;
  const builder = new FakeTicketQueryBuilder(rows, queryError);
  const repository = {
    createQueryBuilder(alias: string) {
      assert.equal(alias, "ticket");
      return builder;
    },
  } as unknown as Repository<Ticket>;
  const manager = {
    getRepository(target: unknown) {
      assert.equal(target, Ticket);
      return repository;
    },
    async query(statement: string) {
      statements.push(statement);
      return [];
    },
  } as unknown as EntityManager;
  const dataSource = {
    async transaction<T>(work: (value: EntityManager) => Promise<T>) {
      transactions += 1;
      return work(manager);
    },
  } as unknown as DataSource;
  return {
    executor: new SupportTicketsQueryExecutor(dataSource),
    get transactions() {
      return transactions;
    },
    statements,
  };
}

class FakeTicketQueryBuilder {
  constructor(
    private readonly rows: readonly Record<string, unknown>[],
    private readonly queryError?: unknown,
  ) {}

  where() {
    return this;
  }

  andWhere() {
    return this;
  }

  select() {
    return this;
  }

  addSelect() {
    return this;
  }

  groupBy() {
    return this;
  }

  addGroupBy() {
    return this;
  }

  orderBy() {
    return this;
  }

  addOrderBy() {
    return this;
  }

  offset() {
    return this;
  }

  limit() {
    return this;
  }

  async getRawMany<T>() {
    if (this.queryError) throw this.queryError;
    return this.rows as T[];
  }
}
