import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  ANALYTICS_DATASET_VERSION,
  ANALYTICS_QUERY_VERSION,
  ANALYTICS_RESULT_VERSION,
} from "@hermes-swarm/api-contracts/analytics";
import {
  getSupportTicketsAnalyticsSchema,
  runAnalyticsQuery,
} from "./analytics";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;

beforeEach(() => {
  (globalThis as { window?: Partial<Window> }).window = {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { window?: Window }).window = originalWindow;
});

describe("analytics admin API", () => {
  it("uses only the schema and typed query contracts without workspace input", async () => {
    const requests: Array<{
      body: unknown;
      csrf: string | null;
      method: string;
      url: string;
    }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/auth/csrf") {
        return Response.json({ csrfToken: "csrf-token" });
      }
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        csrf: new Headers(init?.headers).get("X-CSRF-Token"),
        method: init?.method ?? "GET",
        url,
      });
      return url.endsWith("/schema")
        ? Response.json(schema())
        : Response.json(result());
    };

    await getSupportTicketsAnalyticsSchema("web-session");
    await runAnalyticsQuery("web-session", {
      filters: [],
      groupBy: ["status"],
      measures: [{ aggregation: "count", as: "ticketCount" }],
      page: { size: 50 },
      schemaVersion: ANALYTICS_QUERY_VERSION,
      select: ["status"],
      sort: [{ direction: "desc", field: "ticketCount" }],
      sourceKey: "support.tickets",
      sourceRevision: "support.tickets/v1",
    });

    assert.deepEqual(requests, [
      {
        body: null,
        csrf: null,
        method: "GET",
        url: "/api/admin/analytics/sources/support.tickets/schema",
      },
      {
        body: {
          filters: [],
          groupBy: ["status"],
          measures: [{ aggregation: "count", as: "ticketCount" }],
          page: { size: 50 },
          schemaVersion: ANALYTICS_QUERY_VERSION,
          select: ["status"],
          sort: [{ direction: "desc", field: "ticketCount" }],
          sourceKey: "support.tickets",
          sourceRevision: "support.tickets/v1",
        },
        csrf: "csrf-token",
        method: "POST",
        url: "/api/admin/analytics/query",
      },
    ]);
    assert.equal(JSON.stringify(requests).includes("workspaceId"), false);
    assert.equal(JSON.stringify(requests).includes("rawSql"), false);
  });
});

function schema() {
  return {
    fields: [
      {
        capabilities: {
          aggregations: ["count"],
          filterOperators: ["eq", "neq", "in", "notIn"],
          groupable: true,
          selectable: true,
          sortable: true,
        },
        enumValues: [
          { label: "处理中", value: "open" },
          { label: "已关闭", value: "closed" },
          { label: "已归档", value: "archived" },
        ],
        key: "status",
        label: "工单状态",
        nullable: false,
        scalarType: "enum",
        semanticType: "category",
      },
    ],
    schemaVersion: ANALYTICS_DATASET_VERSION,
    sourceKey: "support.tickets",
    sourceRevision: "support.tickets/v1",
    title: "工单统计",
  };
}
function result() {
  return {
    lineage: {
      generatedAt: "2026-07-25T00:00:00.000Z",
      policyDigest: "a".repeat(64),
      queryDigest: "b".repeat(64),
      sourceKey: "support.tickets",
      sourceRevision: "support.tickets/v1",
    },
    pageInfo: { hasMore: false, nextCursor: null },
    rows: [{ status: "open", ticketCount: 3 }],
    schema: [
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
    ],
    schemaVersion: ANALYTICS_RESULT_VERSION,
    summary: { durationMs: 7, returnedRows: 1, truncated: false },
  };
}
