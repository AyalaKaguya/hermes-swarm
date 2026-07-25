import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { AnalyticsSavedViews2026072500004 } from "./migrations/2026072500004-AnalyticsSavedViews.js";

describe("analytics saved views migration", () => {
  it("creates a workspace-owned table and grants all saved-view permissions", async () => {
    const statements: Array<{ parameters?: unknown[]; sql: string }> = [];
    const migration = new AnalyticsSavedViews2026072500004();

    await migration.up({
      query: async (sql: string, parameters?: unknown[]) => {
        statements.push({ parameters, sql });
        return undefined;
      },
    } as unknown as QueryRunner);

    assert.match(migration.name, /\d{13}$/);
    assert.equal(statements.length, 9);
    assert.match(statements[0]!.sql, /CREATE TABLE "analysis_views"/);
    assert.match(
      statements[0]!.sql,
      /UNIQUE \("workspace_id", "id"\)/,
    );
    assert.match(
      statements[0]!.sql,
      /FOREIGN KEY \("workspace_id"\) REFERENCES "workspaces"\("id"\)/,
    );
    const parameters = statements.flatMap(
      (statement) => statement.parameters ?? [],
    );
    for (const operation of ["list", "read", "create", "update", "delete"]) {
      assert.ok(
        parameters.includes(`analytics.saved_view.${operation}:workspace`),
      );
    }
    assert.deepEqual(statements.at(-1)!.parameters?.[1], [
      "workspace-owner",
      "workspace-admin",
    ]);
  });

  it("refuses an unsafe rollback", async () => {
    await assert.rejects(
      () => new AnalyticsSavedViews2026072500004().down(),
      /cannot be rolled back safely/,
    );
  });
});
