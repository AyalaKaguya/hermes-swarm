import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_QUERY_BUDGET,
  ANALYTICS_QUERY_VERSION,
  type AnalysisQuery,
} from "@hermes-swarm/api-contracts/analytics";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { AnalyticsQueryError } from "./analytics-query.error.js";
import {
  AnalyticsQueryGateway,
  type AnalyticsQueryGatewayOptions,
} from "./analytics-query.gateway.js";
import type {
  AnalyticsAuthorizationContext,
  AnalyticsSourceAdapter,
} from "./analytics-source.adapter.js";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";
import {
  DeterministicFakeAnalyticsAdapter,
  FAKE_SUPPORT_TICKETS_SCHEMA,
} from "./testing/deterministic-fake-analytics.adapter.js";

const BASE_QUERY = {
  schemaVersion: ANALYTICS_QUERY_VERSION,
  select: ["status", "createdAt"],
  sourceKey: "support.tickets",
  sourceRevision: FAKE_SUPPORT_TICKETS_SCHEMA.sourceRevision,
} as const;

const AUTHORIZATION: AnalyticsAuthorizationContext = {
  actorId: "account-1",
  locale: "zh-CN",
  permissions: new Set(["analytics.query:workspace", "ticket.list:workspace"]),
  principalType: "workspace",
  requestId: "request-1",
  timeZone: "Asia/Hong_Kong",
};

describe("AnalyticsQueryGateway", () => {
  it("describes a source only after applying the same trusted authorization", async () => {
    const state = createState();
    const schema = await state.describe("workspace-a");

    assert.equal(schema.sourceKey, "support.tickets");
    assert.equal(schema.sourceRevision, FAKE_SUPPORT_TICKETS_SCHEMA.sourceRevision);
    await rejectsWithCode(
      state.describe("workspace-a", {
        ...AUTHORIZATION,
        permissions: new Set(),
      }),
      "ANALYTICS_SOURCE_NOT_FOUND",
    );
  });

  it("validates saved-view queries against the live schema without executing them", async () => {
    const base = new DeterministicFakeAnalyticsAdapter();
    let executeCalls = 0;
    const adapter: AnalyticsSourceAdapter = {
      kind: "validation-only",
      describe: (...args) => base.describe(...args),
      async execute(...args) {
        executeCalls += 1;
        return base.execute(...args);
      },
    };
    const state = createState({ adapter });
    const validated = await state.validate("workspace-a", {
      ...BASE_QUERY,
      groupBy: ["status"],
      measures: [{ aggregation: "count", as: "ticketCount" }],
      select: ["status"],
    });

    assert.deepEqual(
      validated.resultSchema.map((field) => field.key),
      ["status", "ticketCount"],
    );
    assert.equal(executeCalls, 0);
    await rejectsWithCode(
      state.validate("workspace-a", {
        ...BASE_QUERY,
        sourceRevision: "stale-revision",
      }),
      "ANALYTICS_SOURCE_REVISION_MISMATCH",
    );
  });

  it("isolates deterministic results by trusted WorkspaceContext", async () => {
    const state = createState();
    const workspaceA = await state.execute("workspace-a", BASE_QUERY);
    const workspaceB = await state.execute("workspace-b", BASE_QUERY);

    assert.equal(workspaceA.rows.length, 3);
    assert.equal(workspaceB.rows.length, 1);
    assert.equal(workspaceB.rows[0]?.createdAt, "2026-07-11T08:00:00.000Z");
    assert.equal(workspaceA.lineage.queryDigest, workspaceB.lineage.queryDigest);
    assert.notEqual(workspaceA.lineage.policyDigest, workspaceB.lineage.policyDigest);
    assert.equal(JSON.stringify(workspaceA).includes("2026-07-11"), false);
    assert.equal(JSON.stringify(workspaceB).includes("2026-07-01"), false);
  });

  it("rejects client-controlled workspace fields before contract parsing", async () => {
    const state = createState();
    await rejectsWithCode(
      state.execute("workspace-a", { ...BASE_QUERY, workspaceId: "workspace-b" }),
      "ANALYTICS_QUERY_INVALID",
    );
  });

  it("fails closed without trusted workspace and authorization contexts", async () => {
    const state = createState();
    await rejectsWithCode(
      state.gateway.execute(BASE_QUERY, AUTHORIZATION),
      "ANALYTICS_CONTEXT_REQUIRED",
    );
    await rejectsWithCode(
      state.execute("workspace-a", BASE_QUERY, {
        ...AUTHORIZATION,
        permissions: new Set(),
      }),
      "ANALYTICS_SOURCE_NOT_FOUND",
    );
  });

  it("validates fields, capabilities, filter operators, aggregation and aliases", async () => {
    const state = createState();
    await rejectsWithCode(
      state.execute("workspace-a", { ...BASE_QUERY, select: ["secretField"] }),
      "ANALYTICS_FIELD_UNKNOWN",
    );
    await rejectsWithCode(
      state.execute("workspace-a", {
        ...BASE_QUERY,
        filters: [{ field: "status", operator: "contains", value: "open" }],
      }),
      "ANALYTICS_FILTER_INVALID",
    );
    await rejectsWithCode(
      state.execute("workspace-a", {
        ...BASE_QUERY,
        measures: [{ aggregation: "sum", as: "statusSum", field: "status" }],
        select: [],
      }),
      "ANALYTICS_AGGREGATION_INVALID",
    );
    await rejectsWithCode(
      state.execute("workspace-a", {
        ...BASE_QUERY,
        measures: [{ aggregation: "count", as: "not-safe!" }],
        select: [],
      }),
      "ANALYTICS_QUERY_INVALID",
    );
  });

  it("classifies contract complexity ceilings as a query budget error", async () => {
    const state = createState();
    const filters = Array.from({ length: 31 }, (_, index) => ({
      field: "createdAt",
      operator: "gte" as const,
      value: `2026-07-${String((index % 28) + 1).padStart(2, "0")}T00:00:00.000Z`,
    }));
    await rejectsWithCode(
      state.execute("workspace-a", { ...BASE_QUERY, filters }),
      "ANALYTICS_QUERY_BUDGET_EXCEEDED",
    );
  });

  it("applies filter, group, aggregate, sort and cursor paging deterministically", async () => {
    const state = createState();
    const grouped = await state.execute("workspace-a", {
      ...BASE_QUERY,
      groupBy: ["status"],
      measures: [{ aggregation: "count", as: "ticketCount" }],
      page: { size: 2 },
      select: ["status"],
      sort: [{ direction: "asc", field: "status" }],
    });

    assert.deepEqual(grouped.rows, [
      { status: "closed", ticketCount: 1 },
      { status: "in_progress", ticketCount: 1 },
    ]);
    assert.equal(grouped.pageInfo.hasMore, true);
    assert.ok(grouped.pageInfo.nextCursor);

    const next = await state.execute("workspace-a", {
      ...BASE_QUERY,
      groupBy: ["status"],
      measures: [{ aggregation: "count", as: "ticketCount" }],
      page: { cursor: grouped.pageInfo.nextCursor!, size: 2 },
      select: ["status"],
      sort: [{ direction: "asc", field: "status" }],
    });
    assert.deepEqual(next.rows, [{ status: "open", ticketCount: 1 }]);
    assert.equal(next.pageInfo.hasMore, false);
  });

  it("does not accept a cursor minted for another workspace", async () => {
    const state = createState();
    const first = await state.execute("workspace-a", {
      ...BASE_QUERY,
      page: { size: 1 },
    });
    await rejectsWithCode(
      state.execute("workspace-b", {
        ...BASE_QUERY,
        page: { cursor: first.pageInfo.nextCursor!, size: 1 },
      }),
      "ANALYTICS_ADAPTER_UNAVAILABLE",
    );
  });

  it("enforces the adapter deadline even when the source is slow", async () => {
    const state = createState({
      adapter: new DeterministicFakeAnalyticsAdapter(undefined, { delayMs: 50 }),
      gatewayOptions: { timeoutMs: 5 },
    });
    await rejectsWithCode(
      state.execute("workspace-a", BASE_QUERY),
      "ANALYTICS_QUERY_TIMEOUT",
    );
  });

  it("allows test options to tighten but never expand public hard limits", async () => {
    const state = createState({
      gatewayOptions: {
        maxResponseBytes: ANALYTICS_QUERY_BUDGET.maxResponseBytes * 2,
        timeoutMs: ANALYTICS_QUERY_BUDGET.timeoutMs * 2,
      },
    });
    const resolved = state.gateway as unknown as {
      maxResponseBytes: number;
      timeoutMs: number;
    };
    assert.equal(resolved.maxResponseBytes, ANALYTICS_QUERY_BUDGET.maxResponseBytes);
    assert.equal(resolved.timeoutMs, ANALYTICS_QUERY_BUDGET.timeoutMs);

    const base = new DeterministicFakeAnalyticsAdapter();
    const oversized: AnalyticsSourceAdapter = {
      kind: "oversized",
      describe: (...args) => base.describe(...args),
      async execute(...args) {
        const result = await base.execute(...args);
        return {
          ...result,
          pageInfo: { hasMore: false, nextCursor: null },
          rows: [{
            ...result.rows[0],
            status: "x".repeat(ANALYTICS_QUERY_BUDGET.maxResponseBytes),
          }],
        };
      },
    };
    await rejectsWithCode(
      createState({
        adapter: oversized,
        gatewayOptions: {
          maxResponseBytes: ANALYTICS_QUERY_BUDGET.maxResponseBytes * 2,
        },
      }).execute("workspace-a", BASE_QUERY),
      "ANALYTICS_RESULT_TOO_LARGE",
    );
  });

  it("rejects undeclared columns and non-scalar row values", async () => {
    const base = new DeterministicFakeAnalyticsAdapter();
    const undeclared: AnalyticsSourceAdapter = {
      kind: "malformed",
      describe: (...args) => base.describe(...args),
      async execute(...args) {
        const result = await base.execute(...args);
        return {
          ...result,
          schema: [
            ...result.schema,
            { key: "leak", label: "Leak", nullable: true, scalarType: "string" },
          ],
        };
      },
    };
    await rejectsWithCode(
      createState({ adapter: undeclared }).execute("workspace-a", BASE_QUERY),
      "ANALYTICS_RESULT_INVALID",
    );

    const nonScalar: AnalyticsSourceAdapter = {
      kind: "malformed",
      describe: (...args) => base.describe(...args),
      async execute(...args) {
        const result = await base.execute(...args);
        return {
          ...result,
          rows: [{ ...result.rows[0], status: { secret: true } }] as never,
        };
      },
    };
    await rejectsWithCode(
      createState({ adapter: nonScalar }).execute("workspace-a", BASE_QUERY),
      "ANALYTICS_RESULT_INVALID",
    );
  });

  it("enforces row and serialized byte budgets after adapter execution", async () => {
    const base = new DeterministicFakeAnalyticsAdapter();
    const tooManyRows: AnalyticsSourceAdapter = {
      kind: "malformed",
      describe: (...args) => base.describe(...args),
      async execute(...args) {
        const result = await base.execute(...args);
        return { ...result, rows: [...result.rows, ...result.rows] };
      },
    };
    await rejectsWithCode(
      createState({ adapter: tooManyRows }).execute("workspace-a", {
        ...BASE_QUERY,
        page: { size: 3 },
      }),
      "ANALYTICS_RESULT_TOO_LARGE",
    );

    await rejectsWithCode(
      createState({ gatewayOptions: { maxResponseBytes: 256 } }).execute(
        "workspace-a",
        BASE_QUERY,
      ),
      "ANALYTICS_RESULT_TOO_LARGE",
    );
  });

  it("creates canonical digests independent of object and permission order", async () => {
    const state = createState();
    const first = await state.execute("workspace-a", BASE_QUERY, {
      ...AUTHORIZATION,
      permissions: new Set(["ticket.list:workspace", "analytics.query:workspace"]),
    });
    const second = await state.execute("workspace-a", {
      sourceRevision: BASE_QUERY.sourceRevision,
      sourceKey: BASE_QUERY.sourceKey,
      select: [...BASE_QUERY.select],
      schemaVersion: BASE_QUERY.schemaVersion,
    }, AUTHORIZATION);

    assert.equal(first.lineage.queryDigest, second.lineage.queryDigest);
    assert.equal(first.lineage.policyDigest, second.lineage.policyDigest);
  });
});

function createState(options: {
  adapter?: AnalyticsSourceAdapter;
  gatewayOptions?: AnalyticsQueryGatewayOptions;
} = {}) {
  const workspaceContext = new WorkspaceContextService();
  const registry = new AnalyticsSourceRegistry();
  registry.register({
    adapter: options.adapter ?? new DeterministicFakeAnalyticsAdapter(),
    policyRevision: "analytics-query-policy-v1",
    requiredPermissions: ["analytics.query:workspace"],
    sourceKey: "support.tickets",
  });
  const gateway = new AnalyticsQueryGateway(
    workspaceContext,
    registry,
    options.gatewayOptions,
  );
  return {
    gateway,
    describe(
      workspaceId: string,
      authorization: AnalyticsAuthorizationContext = AUTHORIZATION,
    ) {
      return workspaceContext.run(
        { scopeLevel: "workspace", workspaceId },
        () => gateway.describe("support.tickets", authorization),
      );
    },
    execute(
      workspaceId: string,
      query: unknown,
      authorization: AnalyticsAuthorizationContext = AUTHORIZATION,
    ) {
      return workspaceContext.run(
        { scopeLevel: "workspace", workspaceId },
        () => gateway.execute(query, authorization),
      );
    },
    validate(
      workspaceId: string,
      query: unknown,
      authorization: AnalyticsAuthorizationContext = AUTHORIZATION,
    ) {
      return workspaceContext.run(
        { scopeLevel: "workspace", workspaceId },
        () => gateway.validate(query, authorization),
      );
    },
  };
}

async function rejectsWithCode(
  promise: Promise<unknown>,
  code: AnalyticsQueryError["code"],
) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof AnalyticsQueryError);
    assert.equal(error.code, code);
    return true;
  });
}
