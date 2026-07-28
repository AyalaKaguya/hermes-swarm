import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ANALYTICS_QUERY_VERSION,
  ANALYTICS_VISUALIZATION_VERSION,
} from "./constants.js";
import { ANALYTICS_ERROR_CODES } from "./errors.js";
import {
  AnalysisViewSchema,
  CreateAnalysisViewRequestSchema,
  DeleteAnalysisViewRequestSchema,
  UpdateAnalysisViewRequestSchema,
} from "./analysis-view.js";

const query = {
  filters: [],
  groupBy: ["status"],
  measures: [{ aggregation: "count" as const, as: "ticketCount" }],
  page: { size: 50 },
  schemaVersion: ANALYTICS_QUERY_VERSION,
  select: ["status"],
  sort: [{ direction: "desc" as const, field: "ticketCount" }],
  sourceKey: "support.tickets",
  sourceRevision: "support.tickets/v1",
};
const visualization = {
  schemaVersion: ANALYTICS_VISUALIZATION_VERSION,
  series: [{ field: "ticketCount" }],
  type: "bar" as const,
  x: "status",
};

describe("analysis view contracts", () => {
  it("accepts a strict, workspace-owned saved view", () => {
    const parsed = AnalysisViewSchema.parse({
      createdAt: "2026-07-25T00:00:00.000Z",
      datasetId: "support.tickets",
      id: "11111111-1111-4111-8111-111111111111",
      name: "Tickets by status",
      query,
      revision: 1,
      updatedAt: "2026-07-25T00:00:00.000Z",
      visualization,
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    assert.equal(parsed.workspaceId, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    assert.equal(parsed.revision, 1);
  });

  it("rejects unknown fields, nullable ownership, invalid revisions, and mismatched datasets", () => {
    const base = {
      datasetId: "support.tickets",
      name: "Tickets by status",
      query,
      visualization,
    };

    assert.equal(
      CreateAnalysisViewRequestSchema.safeParse({ ...base, workspaceId: "client-selected" }).success,
      false,
    );
    assert.equal(
      CreateAnalysisViewRequestSchema.safeParse({ ...base, datasetId: "other.dataset" }).success,
      false,
    );
    assert.equal(
      AnalysisViewSchema.safeParse({
        ...base,
        createdAt: "2026-07-25T00:00:00.000Z",
        id: "11111111-1111-4111-8111-111111111111",
        revision: 0,
        updatedAt: "2026-07-25T00:00:00.000Z",
        workspaceId: null,
      }).success,
      false,
    );
  });

  it("requires a positive expectedRevision for every existing-view mutation", () => {
    assert.equal(
      UpdateAnalysisViewRequestSchema.safeParse({ name: "Renamed" }).success,
      false,
    );
    assert.equal(
      UpdateAnalysisViewRequestSchema.safeParse({ expectedRevision: 1 }).success,
      false,
    );
    assert.equal(
      UpdateAnalysisViewRequestSchema.safeParse({
        expectedRevision: 2,
        name: "Renamed",
      }).success,
      true,
    );
    assert.equal(
      DeleteAnalysisViewRequestSchema.safeParse({ expectedRevision: 0 }).success,
      false,
    );
    assert.equal(
      DeleteAnalysisViewRequestSchema.safeParse({ expectedRevision: 2 }).success,
      true,
    );
    assert.ok(ANALYTICS_ERROR_CODES.includes("ANALYTICS_VIEW_NOT_FOUND"));
    assert.ok(ANALYTICS_ERROR_CODES.includes("ANALYTICS_VIEW_REVISION_CONFLICT"));
  });
});
