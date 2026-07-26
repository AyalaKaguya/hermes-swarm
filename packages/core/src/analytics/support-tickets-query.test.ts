import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  executeSupportTicketsQuery,
  SupportTicketsQueryError,
  type SupportTicketsQuery,
  type SupportTicketsQueryBuilder,
  type SupportTicketsQueryFilter,
} from "./support-tickets-query.js";

const BASE_QUERY = {
  filters: [],
  groupBy: [],
  measures: [],
  page: { size: 50 },
  schemaVersion: "hermes.analytics.query/v1",
  select: ["status", "updatedAt"],
  sort: [],
  sourceKey: "support.tickets",
  sourceRevision: "support.tickets/v1",
} satisfies SupportTicketsQuery;

describe("executeSupportTicketsQuery", () => {
  it("owns the trusted workspace predicate, row projection, and pagination", async () => {
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

    const result = await run(state, {
      filters: [{ field: "status", operator: "eq", value: injected }],
      page: { size: 2 },
      select: ["status", "createdAt", "updatedAt"],
    });
    const builder = state.builders[0]!;

    assert.deepEqual(builder.whereCalls, [
      {
        expression: "ticket.workspace_id = :workspaceId",
        parameters: { workspaceId: "workspace-a" },
      },
      {
        expression: "ticket.status = :analytics_filter_0",
        parameters: { analytics_filter_0: injected },
      },
    ]);
    assert.equal(builder.whereCalls[1]?.expression.includes(injected), false);
    assert.deepEqual(builder.selectCalls, [
      ["ticket.status", "status"],
      ["ticket.created_at", "createdAt"],
      ["ticket.updated_at", "updatedAt"],
    ]);
    assert.deepEqual(builder.orderCalls, [
      ["ticket.updated_at", "DESC"],
      ["ticket.id", "DESC"],
    ]);
    assert.equal(builder.offsetValue, 0);
    assert.equal(builder.limitValue, 3);
    assert.equal(result.pageInfo.hasMore, true);
    assert.ok(result.pageInfo.nextCursor);
    assert.deepEqual(result.rows, [
      {
        createdAt: "2026-07-01T00:00:00.000Z",
        status: "open",
        updatedAt: "2026-07-03T00:00:00.000Z",
      },
      {
        createdAt: "2026-07-02T00:00:00.000Z",
        status: "closed",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    ]);
    assert.deepEqual(result.schema, [
      {
        key: "status",
        label: "工单状态",
        nullable: false,
        scalarType: "enum",
        semanticType: "category",
      },
      {
        format: { type: "datetime" },
        key: "createdAt",
        label: "创建时间",
        nullable: false,
        scalarType: "datetime",
      },
      {
        format: { type: "datetime" },
        key: "updatedAt",
        label: "更新时间",
        nullable: false,
        scalarType: "datetime",
      },
    ]);
  });

  it("preserves every supported filter expression and parameter binding", async () => {
    const filters = [
      { field: "status", operator: "neq", value: "closed" },
      { field: "status", operator: "in", value: ["open", "closed"] },
      { field: "status", operator: "notIn", value: ["archived"] },
      { field: "createdAt", operator: "gt", value: "2026-07-01" },
      { field: "createdAt", operator: "gte", value: "2026-07-02" },
      { field: "updatedAt", operator: "lt", value: "2026-08-01" },
      { field: "updatedAt", operator: "lte", value: "2026-07-31" },
      { field: "archivedAt", operator: "isNull" },
      { field: "lastMessageAt", operator: "isNotNull" },
    ] satisfies SupportTicketsQueryFilter[];
    const state = createState([]);

    await run(state, { filters });

    assert.deepEqual(
      state.builders[0]!.whereCalls.slice(1).map((call) => call.expression),
      [
        "ticket.status <> :analytics_filter_0",
        "ticket.status IN (:...analytics_filter_1)",
        "ticket.status NOT IN (:...analytics_filter_2)",
        "ticket.created_at > :analytics_filter_3",
        "ticket.created_at >= :analytics_filter_4",
        "ticket.updated_at < :analytics_filter_5",
        "ticket.updated_at <= :analytics_filter_6",
        "ticket.archived_at IS NULL",
        "ticket.last_message_at IS NOT NULL",
      ],
    );
    assert.deepEqual(state.builders[0]!.whereCalls[2]?.parameters, {
      analytics_filter_1: ["open", "closed"],
    });
    assert.equal(state.builders[0]!.whereCalls[8]?.parameters, undefined);
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

    const result = await run(state, {
      groupBy: ["status"],
      measures: [
        { aggregation: "count", as: "ticketCount" },
        { aggregation: "min", as: "firstCreatedAt", field: "createdAt" },
        { aggregation: "max", as: "lastUpdatedAt", field: "updatedAt" },
      ],
      select: ["status"],
      sort: [{ direction: "desc", field: "ticketCount" }],
    });
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
    assert.deepEqual(result.schema, [
      {
        key: "status",
        label: "工单状态",
        nullable: false,
        scalarType: "enum",
        semanticType: "category",
      },
      {
        key: "ticketCount",
        label: "ticketCount",
        nullable: false,
        scalarType: "number",
      },
      {
        key: "firstCreatedAt",
        label: "firstCreatedAt",
        nullable: true,
        scalarType: "datetime",
      },
      {
        key: "lastUpdatedAt",
        label: "lastUpdatedAt",
        nullable: true,
        scalarType: "datetime",
      },
    ]);
  });

  it("keeps cursors bound to both the workspace and canonical query digest", async () => {
    const first = createState([
      { status: "open", updatedAt: "2026-07-03T00:00:00.000Z" },
      { status: "closed", updatedAt: "2026-07-02T00:00:00.000Z" },
    ]);
    const firstPage = await run(first, { page: { size: 1 } });
    const cursor = firstPage.pageInfo.nextCursor!;
    const payload = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    ) as Record<string, unknown>;

    assert.equal(payload.offset, 1);
    assert.match(String(payload.queryDigest), /^[a-f0-9]{64}$/);
    assert.match(String(payload.scopeDigest), /^[a-f0-9]{64}$/);

    const next = createState([]);
    await run(next, { page: { cursor, size: 1 } });
    assert.equal(next.builders[0]!.offsetValue, 1);

    const otherWorkspace = createState([]);
    await assertQueryError(
      () => run(otherWorkspace, { page: { cursor, size: 1 } }, "workspace-b"),
      "ANALYTICS_QUERY_INVALID",
    );
    assert.equal(otherWorkspace.builders[0]!.getRawManyCalls, 0);
    assert.deepEqual(otherWorkspace.builders[0]!.whereCalls[0], {
      expression: "ticket.workspace_id = :workspaceId",
      parameters: { workspaceId: "workspace-b" },
    });

    const changedQuery = createState([]);
    await assertQueryError(
      () =>
        run(changedQuery, {
          page: { cursor, size: 1 },
          sort: [{ direction: "asc", field: "updatedAt" }],
        }),
      "ANALYTICS_QUERY_INVALID",
    );
    assert.equal(changedQuery.builders[0]!.getRawManyCalls, 0);
  });

  it("rejects invalid context, source, fields, filters, and aggregations", async () => {
    const invalidWorkspace = createState([]);
    await assertQueryError(
      () => run(invalidWorkspace, {}, "   "),
      "ANALYTICS_CONTEXT_REQUIRED",
    );
    assert.equal(invalidWorkspace.builders.length, 0);

    for (const source of [
      { sourceKey: "other.source" },
      { sourceRevision: "support.tickets/v2" },
    ]) {
      const state = createState([]);
      await assertQueryError(
        () => run(state, source),
        "ANALYTICS_SOURCE_REVISION_MISMATCH",
      );
      assert.equal(state.builders.length, 0);
    }

    await assertQueryError(
      () => run(createState([]), { select: ["subject"] }),
      "ANALYTICS_FIELD_UNKNOWN",
    );
    await assertQueryError(
      () =>
        run(createState([]), {
          filters: [
            { field: "status", operator: "contains", value: "open" },
          ],
        }),
      "ANALYTICS_FILTER_INVALID",
    );
    await assertQueryError(
      () =>
        run(createState([]), {
          groupBy: ["status"],
          measures: [
            { aggregation: "countDistinct", as: "statuses", field: "status" },
          ],
        }),
      "ANALYTICS_AGGREGATION_INVALID",
    );
  });

  it("rejects invalid non-null raw values", async () => {
    await assertQueryError(
      () => run(createState([{ status: 42, updatedAt: "not-a-date" }])),
      "ANALYTICS_RESULT_INVALID",
    );
    await assertQueryError(
      () => run(createState([{ status: "open", updatedAt: null }])),
      "ANALYTICS_RESULT_INVALID",
    );
  });

  it("honors aborts before builder creation and after database execution", async () => {
    const before = new AbortController();
    const beforeReason = new Error("cancelled before query");
    before.abort(beforeReason);
    const beforeState = createState([]);
    await assert.rejects(
      executeSupportTicketsQuery({
        createQueryBuilder: beforeState.createQueryBuilder,
        query: BASE_QUERY,
        signal: before.signal,
        workspaceId: "workspace-a",
      }),
      (error: unknown) => error === beforeReason,
    );
    assert.equal(beforeState.builders.length, 0);

    const after = new AbortController();
    const afterReason = new Error("cancelled during query");
    const afterState = createState([], () => after.abort(afterReason));
    await assert.rejects(
      executeSupportTicketsQuery({
        createQueryBuilder: afterState.createQueryBuilder,
        query: BASE_QUERY,
        signal: after.signal,
        workspaceId: "workspace-a",
      }),
      (error: unknown) => error === afterReason,
    );
    assert.equal(afterState.builders[0]!.getRawManyCalls, 1);
  });
});

type QueryOverrides = Partial<SupportTicketsQuery>;

function makeQuery(overrides: QueryOverrides = {}): SupportTicketsQuery {
  return {
    ...BASE_QUERY,
    ...overrides,
    page: overrides.page ?? BASE_QUERY.page,
  };
}

function run(
  state: ReturnType<typeof createState>,
  overrides: QueryOverrides = {},
  workspaceId = "workspace-a",
) {
  return executeSupportTicketsQuery({
    createQueryBuilder: state.createQueryBuilder,
    query: makeQuery(overrides),
    signal: new AbortController().signal,
    workspaceId,
  });
}

async function assertQueryError(
  action: () => Promise<unknown>,
  code: SupportTicketsQueryError["code"],
) {
  await assert.rejects(action, (error: unknown) => {
    assert.ok(error instanceof SupportTicketsQueryError);
    assert.equal(error.code, code);
    return true;
  });
}

function createState(
  rows: readonly Readonly<Record<string, unknown>>[],
  afterGetRawMany?: () => void,
) {
  const builders: FakeSupportTicketsQueryBuilder[] = [];
  return {
    builders,
    createQueryBuilder: () => {
      const builder = new FakeSupportTicketsQueryBuilder(
        rows,
        afterGetRawMany,
      );
      builders.push(builder);
      return builder;
    },
  };
}

class FakeSupportTicketsQueryBuilder implements SupportTicketsQueryBuilder {
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

  constructor(
    private readonly rows: readonly Readonly<Record<string, unknown>>[],
    private readonly afterGetRawMany?: () => void,
  ) {}

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
    this.afterGetRawMany?.();
    return this.rows as T[];
  }
}
