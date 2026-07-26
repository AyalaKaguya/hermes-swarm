import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_QUERY_VERSION,
  ANALYTICS_DATASET_VERSION,
  type DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";
import {
  AnalyticsQueryValidationError,
  expectedAnalysisResultSchema,
  parseAnalysisQuery,
  validateAnalysisQueryAgainstDataset,
} from "./query-validation.js";

const schema: DatasetSchema = {
  fields: [
    {
      capabilities: {
        aggregations: [],
        filterOperators: ["eq", "in"],
        groupable: true,
        selectable: true,
        sortable: true,
      },
      enumValues: [
        { label: "Open", value: "open" },
        { label: "Closed", value: "closed" },
      ],
      key: "status",
      label: "Status",
      nullable: false,
      scalarType: "enum",
      semanticType: "status",
    },
  ],
  label: "Tickets",
  schemaVersion: ANALYTICS_DATASET_VERSION,
  sourceKey: "support.tickets",
  sourceRevision: "support.tickets/v1",
};

const query = {
  filters: [],
  groupBy: [],
  measures: [],
  page: { size: 50 },
  schemaVersion: ANALYTICS_QUERY_VERSION,
  select: ["status"],
  sort: [],
  sourceKey: "support.tickets",
  sourceRevision: "support.tickets/v1",
};

describe("shared analytics query validation", () => {
  it("normalizes a typed query and produces its result schema", () => {
    const parsed = parseAnalysisQuery(query);
    validateAnalysisQueryAgainstDataset(parsed, schema);

    assert.deepEqual(expectedAnalysisResultSchema(parsed, schema), [
      {
        key: "status",
        label: "Status",
        nullable: false,
        scalarType: "enum",
        semanticType: "status",
      },
    ]);
  });

  it("rejects server-controlled fields before contract parsing", () => {
    assert.throws(
      () => parseAnalysisQuery({ ...query, workspaceId: "workspace-b" }),
      (error: unknown) =>
        error instanceof AnalyticsQueryValidationError &&
        error.code === "ANALYTICS_QUERY_INVALID",
    );
  });

  it("rejects fields and enum values outside the described dataset", () => {
    const invalidField = parseAnalysisQuery({ ...query, select: ["subject"] });
    assert.throws(
      () => validateAnalysisQueryAgainstDataset(invalidField, schema),
      (error: unknown) =>
        error instanceof AnalyticsQueryValidationError &&
        error.code === "ANALYTICS_FIELD_UNKNOWN",
    );

    const invalidFilter = parseAnalysisQuery({
      ...query,
      filters: [{ field: "status", operator: "eq", value: "private" }],
    });
    assert.throws(
      () => validateAnalysisQueryAgainstDataset(invalidFilter, schema),
      (error: unknown) =>
        error instanceof AnalyticsQueryValidationError &&
        error.code === "ANALYTICS_FILTER_INVALID",
    );
  });
});
