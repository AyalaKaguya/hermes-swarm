import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_QUERY_VERSION,
  AnalysisQuerySchema,
  type AnalysisQuery,
} from "@hermes-swarm/api-contracts/analytics";
import type { Ticket } from "@hermes-swarm/core";
import type { Repository } from "typeorm";
import { AnalyticsQueryError } from "./analytics-query.error.js";
import type { AnalyticsExecutionContext } from "./analytics-source.adapter.js";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";
import { SupportTicketsAnalyticsAdapter } from "./support-tickets-analytics.adapter.js";
import {
  SUPPORT_TICKETS_DATASET_SCHEMA,
  SUPPORT_TICKETS_SOURCE_REVISION,
} from "./support-tickets-analytics.constants.js";

const CONTEXT = {
  actorId: "account-a",
  locale: "zh-Hans",
  permissions: new Set(["analytics.ticket_dataset.query:workspace"]),
  principalType: "workspace",
  requestId: "request-a",
  scopeLevel: "workspace",
  timeZone: "Asia/Hong_Kong",
  workspaceId: "workspace-a",
} satisfies AnalyticsExecutionContext;

describe("SupportTicketsAnalyticsAdapter", () => {
  it("publishes only status and lifecycle timestamps", async () => {
    const state = createState([]);
    state.adapter.onModuleInit();

    const schema = await state.adapter.describe(
      CONTEXT,
      "support.tickets",
      new AbortController().signal,
    );
    assert.deepEqual(
      schema.fields.map((field) => field.key),
      [
        "status",
        "createdAt",
        "updatedAt",
        "lastMessageAt",
        "requesterClosedAt",
        "handlerClosedAt",
        "archivedAt",
      ],
    );
    for (const forbidden of [
      "id",
      "subject",
      "account",
      "message",
      "attachment",
      "workspaceId",
    ]) {
      assert.equal(JSON.stringify(schema).includes(`\"${forbidden}\"`), false);
    }
    assert.equal(
      state.registry.resolve("support.tickets")?.adapter,
      state.adapter,
    );

    state.adapter.onModuleDestroy();
    assert.equal(state.registry.resolve("support.tickets"), null);
  });

  it("always binds workspace and filter values while using size plus one", async () => {
    const injected = "open' OR TRUE --";
    const state = createState([
      {
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
        status: "open",
        updatedAt: new Date("2026-07-03T00:00:00.000Z"),
      },
      {
        createdAt: new Date("2026-07-02T00:00:00.000Z"),
        status: "closed",
        updatedAt: new Date("2026-07-02T00:00:00.000Z"),
      },
      {
        createdAt: new Date("2026-06-30T00:00:00.000Z"),
        status: "archived",
        updatedAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ]);
    const query = parseQuery({
      filters: [{ field: "status", operator: "eq", value: injected }],
      page: { size: 2 },
      select: ["status", "createdAt", "updatedAt"],
    });
    const result = await state.adapter.execute(
      CONTEXT,
      query,
      new AbortController().signal,
    );
    const builder = state.builders[0]!;

    assert.deepEqual(builder.whereCalls[0], {
      expression: "ticket.workspace_id = :workspaceId",
      parameters: { workspaceId: "workspace-a" },
    });
    assert.equal(builder.whereCalls[1]?.expression.includes(injected), false);
    assert.deepEqual(builder.whereCalls[1]?.parameters, {
      analytics_filter_0: injected,
    });
    assert.equal(builder.limitValue, 3);
    assert.equal(builder.offsetValue, 0);
    assert.deepEqual(builder.orderCalls, [
      ["ticket.updated_at", "DESC"],
      ["ticket.id", "DESC"],
    ]);
    assert.equal(result.rows.length, 2);
    assert.equal(result.pageInfo.hasMore, true);
    assert.ok(result.pageInfo.nextCursor);
    assert.deepEqual(Object.keys(result.rows[0]!), [
      "status",
      "createdAt",
      "updatedAt",
    ]);
  });

  it("supports grouped count/min/max and normalizes PostgreSQL raw values", async () => {
    const state = createState([
      {
        firstCreatedAt: new Date("2026-07-01T00:00:00.000Z"),
        lastUpdatedAt: "2026-07-03T00:00:00+00:00",
        status: "open",
        ticketCount: "12",
      },
    ]);
    const query = parseQuery({
      groupBy: ["status"],
      measures: [
        { aggregation: "count", as: "ticketCount" },
        { aggregation: "min", as: "firstCreatedAt", field: "createdAt" },
        { aggregation: "max", as: "lastUpdatedAt", field: "updatedAt" },
      ],
      select: ["status"],
      sort: [{ direction: "desc", field: "ticketCount" }],
    });
    const result = await state.adapter.execute(
      CONTEXT,
      query,
      new AbortController().signal,
    );
    const builder = state.builders[0]!;

    assert.deepEqual(builder.groupByCalls, ["ticket.status"]);
    assert.deepEqual(builder.selectCalls, [
      ["ticket.status", "status"],
      ["COUNT(*)", "ticketCount"],
      ["MIN(ticket.created_at)", "firstCreatedAt"],
      ["MAX(ticket.updated_at)", "lastUpdatedAt"],
    ]);
    assert.deepEqual(builder.orderCalls, [["COUNT(*)", "DESC"]]);
    assert.deepEqual(result.rows, [
      {
        firstCreatedAt: "2026-07-01T00:00:00.000Z",
        lastUpdatedAt: "2026-07-03T00:00:00.000Z",
        status: "open",
        ticketCount: 12,
      },
    ]);
  });

  it("rejects a cursor minted for another trusted workspace", async () => {
    const first = createState([
      {
        status: "open",
        updatedAt: new Date("2026-07-03T00:00:00.000Z"),
      },
      {
        status: "closed",
        updatedAt: new Date("2026-07-02T00:00:00.000Z"),
      },
    ]);
    const query = parseQuery({ page: { size: 1 }, select: ["status", "updatedAt"] });
    const page = await first.adapter.execute(
      CONTEXT,
      query,
      new AbortController().signal,
    );
    assert.ok(page.pageInfo.nextCursor);

    const second = createState([]);
    const workspaceB = { ...CONTEXT, workspaceId: "workspace-b" };
    await assert.rejects(
      second.adapter.execute(
        workspaceB,
        parseQuery({
          page: { cursor: page.pageInfo.nextCursor!, size: 1 },
          select: ["status", "updatedAt"],
        }),
        new AbortController().signal,
      ),
      (error: unknown) => {
        assert.ok(error instanceof AnalyticsQueryError);
        assert.equal(error.code, "ANALYTICS_QUERY_INVALID");
        return true;
      },
    );
    assert.equal(second.builders[0]?.getRawManyCalls, 0);
  });
});

function parseQuery(
  input: Partial<AnalysisQuery> & Pick<AnalysisQuery, "select">,
) {
  return AnalysisQuerySchema.parse({
    schemaVersion: ANALYTICS_QUERY_VERSION,
    sourceKey: "support.tickets",
    sourceRevision: SUPPORT_TICKETS_SOURCE_REVISION,
    ...input,
  });
}

function createState(rows: readonly Readonly<Record<string, unknown>>[]) {
  const builders: FakeTicketQueryBuilder[] = [];
  const repository = {
    createQueryBuilder(alias: string) {
      assert.equal(alias, "ticket");
      const builder = new FakeTicketQueryBuilder(rows);
      builders.push(builder);
      return builder;
    },
  } as unknown as Repository<Ticket>;
  const registry = new AnalyticsSourceRegistry();
  return {
    adapter: new SupportTicketsAnalyticsAdapter(repository, registry),
    builders,
    registry,
  };
}

class FakeTicketQueryBuilder {
  getRawManyCalls = 0;
  groupByCalls: string[] = [];
  limitValue: number | null = null;
  offsetValue: number | null = null;
  orderCalls: Array<[string, "ASC" | "DESC"]> = [];
  selectCalls: Array<[string, string]> = [];
  whereCalls: Array<{
    expression: string;
    parameters?: Record<string, unknown>;
  }> = [];

  constructor(private readonly rows: readonly Readonly<Record<string, unknown>>[]) {}

  where(expression: string, parameters?: Record<string, unknown>) {
    this.whereCalls.push({ expression, parameters });
    return this;
  }

  andWhere(expression: string, parameters?: Record<string, unknown>) {
    this.whereCalls.push({ expression, parameters });
    return this;
  }

  select(expression: string, alias: string) {
    this.selectCalls.push([expression, alias]);
    return this;
  }

  addSelect(expression: string, alias: string) {
    this.selectCalls.push([expression, alias]);
    return this;
  }

  groupBy(expression: string) {
    this.groupByCalls.push(expression);
    return this;
  }

  addGroupBy(expression: string) {
    this.groupByCalls.push(expression);
    return this;
  }

  orderBy(expression: string, direction: "ASC" | "DESC") {
    this.orderCalls.push([expression, direction]);
    return this;
  }

  addOrderBy(expression: string, direction: "ASC" | "DESC") {
    this.orderCalls.push([expression, direction]);
    return this;
  }

  offset(value: number) {
    this.offsetValue = value;
    return this;
  }

  limit(value: number) {
    this.limitValue = value;
    return this;
  }

  async getRawMany<T>() {
    this.getRawManyCalls += 1;
    return this.rows as T[];
  }
}

assert.equal(SUPPORT_TICKETS_DATASET_SCHEMA.sourceRevision, "support.tickets/v1");
