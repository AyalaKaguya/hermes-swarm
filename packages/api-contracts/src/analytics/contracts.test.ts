import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_DATASET_VERSION,
  ANALYTICS_ERROR_CODES,
  ANALYTICS_QUERY_BUDGET,
  ANALYTICS_QUERY_MAX_FILTERS,
  ANALYTICS_QUERY_MAX_GROUPS,
  ANALYTICS_QUERY_MAX_IN_VALUES,
  ANALYTICS_QUERY_MAX_MEASURES,
  ANALYTICS_QUERY_MAX_PAGE_SIZE,
  ANALYTICS_QUERY_MAX_RESPONSE_BYTES,
  ANALYTICS_QUERY_MAX_SORTS,
  ANALYTICS_QUERY_TIMEOUT_MS,
  ANALYTICS_QUERY_VERSION,
  ANALYTICS_RESULT_VERSION,
  ANALYTICS_VISUALIZATION_VERSION,
  AnalysisQuerySchema,
  AnalyticsErrorCodeSchema,
  DatasetResultSchema,
  DatasetSchema,
  VisualizationSpecSchema,
} from "./index.js";

const numberField = {
  capabilities: {
    aggregations: ["count", "countDistinct", "sum", "avg", "min", "max"],
    filterOperators: ["eq", "neq", "in", "notIn", "gt", "gte", "lt", "lte", "isNull", "isNotNull"],
    groupable: true,
    selectable: true,
    sortable: true,
  },
  key: "ticketCount",
  label: "Tickets",
  nullable: false,
  scalarType: "number",
} as const;

const dataset = {
  fields: [numberField],
  schemaVersion: ANALYTICS_DATASET_VERSION,
  sourceKey: "support.tickets",
  sourceRevision: "tickets-v1",
  title: "Support tickets",
} as const;

const query = {
  schemaVersion: ANALYTICS_QUERY_VERSION,
  select: ["ticketCount"],
  sourceKey: "support.tickets",
  sourceRevision: "tickets-v1",
} as const;

const result = {
  lineage: {
    generatedAt: "2026-07-25T00:00:00.000Z",
    policyDigest: "b".repeat(64),
    queryDigest: "a".repeat(64),
    sourceKey: "support.tickets",
    sourceRevision: "tickets-v1",
  },
  pageInfo: { hasMore: false, nextCursor: null },
  rows: [{ ticketCount: 3 }],
  schema: [
    {
      key: "ticketCount",
      label: "Tickets",
      nullable: false,
      scalarType: "number",
    },
  ],
  schemaVersion: ANALYTICS_RESULT_VERSION,
  summary: { durationMs: 12, returnedRows: 1, truncated: false },
} as const;

describe("analytics dataset contracts", () => {
  it("accepts explicit field capabilities and rejects unknown keys", () => {
    assert.equal(DatasetSchema.safeParse(dataset).success, true);
    assert.equal(DatasetSchema.safeParse({ ...dataset, workspaceId: "workspace-a" }).success, false);
    assert.equal(
      DatasetSchema.safeParse({
        ...dataset,
        fields: [{ ...numberField, databaseColumn: "tickets.workspace_id" }],
      }).success,
      false,
    );
  });

  it("rejects unknown versions and incompatible field capabilities", () => {
    assert.equal(DatasetSchema.safeParse({ ...dataset, schemaVersion: "1" }).success, false);
    assert.equal(
      DatasetSchema.safeParse({
        ...dataset,
        fields: [
          {
            ...numberField,
            capabilities: { ...numberField.capabilities, aggregations: ["median"] },
          },
        ],
      }).success,
      false,
    );
    assert.equal(
      DatasetSchema.safeParse({
        ...dataset,
        fields: [
          {
            ...numberField,
            capabilities: { ...numberField.capabilities, aggregations: ["sum"] },
            scalarType: "string",
          },
        ],
      }).success,
      false,
    );
  });

  it("requires enum dictionaries only for enum fields", () => {
    assert.equal(
      DatasetSchema.safeParse({
        ...dataset,
        fields: [
          {
            capabilities: {
              aggregations: ["count"],
              filterOperators: ["eq"],
              groupable: true,
              selectable: true,
              sortable: true,
            },
            key: "status",
            label: "Status",
            nullable: false,
            scalarType: "enum",
          },
        ],
      }).success,
      false,
    );
    assert.equal(
      DatasetSchema.safeParse({
        ...dataset,
        fields: [{ ...numberField, enumValues: [{ label: "Open", value: "open" }] }],
      }).success,
      false,
    );
  });
});

describe("analytics query contracts", () => {
  it("defaults pagination while keeping the request strictly server-scoped", () => {
    const parsed = AnalysisQuerySchema.parse(query);
    assert.deepEqual(parsed.page, { size: 50 });
    assert.deepEqual(parsed.filters, []);
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, workspaceId: "workspace-a" }).success, false);
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, rawSql: "select * from tickets" }).success, false);
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, credentials: { password: "secret" } }).success, false);
  });

  it("models operator-specific values and rejects unknown operators", () => {
    assert.equal(
      AnalysisQuerySchema.safeParse({
        ...query,
        filters: [{ field: "status", operator: "in", value: ["open", "closed"] }],
      }).success,
      true,
    );
    assert.equal(
      AnalysisQuerySchema.safeParse({
        ...query,
        filters: [{ field: "status", operator: "matches", value: ".*" }],
      }).success,
      false,
    );
    assert.equal(
      AnalysisQuerySchema.safeParse({
        ...query,
        filters: [{ field: "status", operator: "isNull", value: null }],
      }).success,
      false,
    );
  });

  it("publishes and enforces the fixed query budget", () => {
    assert.deepEqual(ANALYTICS_QUERY_BUDGET, {
      defaultPageSize: 50,
      maxFilters: 30,
      maxGroupByFields: 3,
      maxInValues: 100,
      maxMeasures: 8,
      maxPageSize: 500,
      maxResponseBytes: 2_097_152,
      maxSortFields: 3,
      timeoutMs: 10_000,
    });

    const filters = Array.from({ length: ANALYTICS_QUERY_MAX_FILTERS }, (_, index) => ({
      field: `field${index}`,
      operator: "eq" as const,
      value: index,
    }));
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, filters }).success, true);
    assert.equal(
      AnalysisQuerySchema.safeParse({ ...query, filters: [...filters, filters[0]] }).success,
      false,
    );

    const groupBy = Array.from({ length: ANALYTICS_QUERY_MAX_GROUPS }, (_, index) => `group${index}`);
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, groupBy }).success, true);
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, groupBy: [...groupBy, "group3"] }).success, false);

    const measures = Array.from({ length: ANALYTICS_QUERY_MAX_MEASURES }, (_, index) => ({
      aggregation: "count" as const,
      as: `measure${index}`,
    }));
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, measures }).success, true);
    assert.equal(
      AnalysisQuerySchema.safeParse({ ...query, measures: [...measures, { aggregation: "count", as: "measure8" }] }).success,
      false,
    );

    const sort = Array.from({ length: ANALYTICS_QUERY_MAX_SORTS }, (_, index) => ({
      direction: "asc" as const,
      field: `sort${index}`,
    }));
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, sort }).success, true);
    assert.equal(
      AnalysisQuerySchema.safeParse({ ...query, sort: [...sort, { direction: "asc", field: "sort3" }] }).success,
      false,
    );

    const inValues = Array.from({ length: ANALYTICS_QUERY_MAX_IN_VALUES }, (_, index) => index);
    assert.equal(
      AnalysisQuerySchema.safeParse({
        ...query,
        filters: [{ field: "ticketCount", operator: "in", value: inValues }],
      }).success,
      true,
    );
    assert.equal(
      AnalysisQuerySchema.safeParse({
        ...query,
        filters: [{ field: "ticketCount", operator: "in", value: [...inValues, 100] }],
      }).success,
      false,
    );
    assert.equal(
      AnalysisQuerySchema.safeParse({ ...query, page: { size: ANALYTICS_QUERY_MAX_PAGE_SIZE } }).success,
      true,
    );
    assert.equal(
      AnalysisQuerySchema.safeParse({ ...query, page: { size: ANALYTICS_QUERY_MAX_PAGE_SIZE + 1 } }).success,
      false,
    );
  });

  it("rejects an unsupported query contract version", () => {
    assert.equal(AnalysisQuerySchema.safeParse({ ...query, schemaVersion: "hermes.analytics.query/v2" }).success, false);
  });
});

describe("analytics result contracts", () => {
  it("accepts scalar rows and rejects undeclared or structured values", () => {
    assert.equal(DatasetResultSchema.safeParse(result).success, true);
    assert.equal(
      DatasetResultSchema.safeParse({ ...result, rows: [{ ticketCount: 3, secret: "hidden" }] }).success,
      false,
    );
    assert.equal(
      DatasetResultSchema.safeParse({ ...result, rows: [{ ticketCount: { nested: true } }] }).success,
      false,
    );
    assert.equal(
      DatasetResultSchema.safeParse({ ...result, rows: [{ ticketCount: "three" }] }).success,
      false,
    );
  });

  it("enforces row, timeout, byte, and version boundaries", () => {
    assert.equal(
      DatasetResultSchema.safeParse({
        ...result,
        summary: { ...result.summary, durationMs: ANALYTICS_QUERY_TIMEOUT_MS },
      }).success,
      true,
    );
    assert.equal(
      DatasetResultSchema.safeParse({
        ...result,
        summary: { ...result.summary, durationMs: ANALYTICS_QUERY_TIMEOUT_MS + 1 },
      }).success,
      false,
    );
    assert.equal(
      DatasetResultSchema.safeParse({ ...result, schemaVersion: "hermes.analytics.result/v2" }).success,
      false,
    );

    const stringResult = {
      ...result,
      rows: [{ message: "x".repeat(ANALYTICS_QUERY_MAX_RESPONSE_BYTES) }],
      schema: [{ key: "message", label: "Message", nullable: false, scalarType: "string" }],
    };
    assert.equal(DatasetResultSchema.safeParse(stringResult).success, false);
  });
});

describe("analytics visualization contracts", () => {
  const base = { schemaVersion: ANALYTICS_VISUALIZATION_VERSION } as const;
  const validSpecs = [
    { ...base, columns: [{ field: "status", label: "Status" }], type: "table" },
    { ...base, format: { type: "number" }, measure: "ticketCount", type: "kpi" },
    { ...base, series: [{ field: "ticketCount" }], stacked: true, type: "bar", x: "status" },
    { ...base, series: [{ axis: "left", field: "ticketCount" }], type: "line", x: "createdAt" },
    { ...base, series: [{ field: "ticketCount" }], type: "area", x: "createdAt" },
    { ...base, dimension: "status", measure: "ticketCount", showLegend: true, type: "pie" },
  ];

  it("accepts the table, KPI, Cartesian, and pie data-only union", () => {
    for (const spec of validSpecs) {
      assert.equal(VisualizationSpecSchema.safeParse(spec).success, true, JSON.stringify(spec));
    }
  });

  it("rejects cross-variant, renderer-specific, and unknown-version properties", () => {
    assert.equal(
      VisualizationSpecSchema.safeParse({
        ...base,
        dimension: "status",
        series: [{ field: "ticketCount" }],
        type: "bar",
        x: "status",
      }).success,
      false,
    );
    assert.equal(
      VisualizationSpecSchema.safeParse({
        ...base,
        rechartsProps: { animationDuration: 500 },
        series: [{ field: "ticketCount" }],
        type: "line",
        x: "createdAt",
      }).success,
      false,
    );
    assert.equal(
      VisualizationSpecSchema.safeParse({
        ...base,
        schemaVersion: "hermes.analytics.visualization/v2",
        type: "table",
      }).success,
      false,
    );
  });
});

describe("analytics errors", () => {
  it("exports a finite stable error-code vocabulary", () => {
    assert.equal(new Set(ANALYTICS_ERROR_CODES).size, ANALYTICS_ERROR_CODES.length);
    for (const code of ANALYTICS_ERROR_CODES) {
      assert.equal(AnalyticsErrorCodeSchema.safeParse(code).success, true);
    }
    assert.equal(AnalyticsErrorCodeSchema.safeParse("DATABASE_ERROR").success, false);
  });
});
