import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { AnalysisView } from "./analysis-view.entity.js";

describe("AnalysisView entity", () => {
  it("persists a non-null workspace owner and positive optimistic revision", () => {
    const metadata = getMetadataArgsStorage();
    const table = metadata.tables.find((item) => item.target === AnalysisView);
    const columns = metadata.columns.filter((item) =>
      item.target === AnalysisView || item.target.name === "WorkspaceOwnedBaseEntity"
    );
    const checks = metadata.checks.filter((item) => item.target === AnalysisView);
    const indices = metadata.indices.filter((item) => item.target === AnalysisView);

    assert.equal(table?.name, "analysis_views");
    assert.equal(
      columns.find((item) => item.propertyName === "workspaceId")?.options.nullable,
      undefined,
    );
    assert.equal(
      columns.find((item) => item.propertyName === "revision")?.options.default,
      1,
    );
    assert.ok(checks.some((item) => String(item.expression).includes('"revision" > 0')));
    assert.ok(
      checks.some((item) =>
        String(item.expression).includes(`jsonb_typeof("query") = 'object'`)
      ),
    );
    assert.ok(
      checks.some((item) =>
        String(item.expression).includes(
          `jsonb_typeof("visualization") = 'object'`,
        )
      ),
    );
    assert.ok(
      indices.some((item) =>
        item.name === "UQ_analysis_views_workspace_id" &&
        item.unique === true &&
        Array.isArray(item.columns) &&
        item.columns.join(",") === "workspaceId,id"
      ),
    );
  });
});
