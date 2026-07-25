import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { QueryRunner } from "typeorm";
import { AnalyticsTicketExplorerPermissions2026072500002 } from "./migrations/2026072500002-AnalyticsTicketExplorerPermissions.js";

describe("analytics ticket explorer permissions migration", () => {
  it("upserts the dataset and page permissions for existing owner/admin roles", async () => {
    const statements: Array<{ parameters?: unknown[]; sql: string }> = [];
    const migration = new AnalyticsTicketExplorerPermissions2026072500002();

    await migration.up({
      query: async (sql: string, parameters?: unknown[]) => {
        statements.push({ parameters, sql });
        return undefined;
      },
    } as unknown as QueryRunner);

    assert.match(migration.name, /\d{13}$/);
    assert.equal(statements.length, 4);
    const parameters = statements.flatMap((statement) => statement.parameters ?? []);
    assert.ok(parameters.includes("analytics.ticket_dataset.describe:workspace"));
    assert.ok(parameters.includes("analytics.ticket_dataset.query:workspace"));
    assert.ok(parameters.includes("page.analytics.access:workspace"));
    assert.match(statements.at(-1)!.sql, /"role"\."scope" = 'workspace'/);
    assert.deepEqual(statements.at(-1)!.parameters?.[1], [
      "workspace-owner",
      "workspace-admin",
    ]);
  });

  it("refuses an unsafe rollback", async () => {
    await assert.rejects(
      () => new AnalyticsTicketExplorerPermissions2026072500002().down(),
      /cannot be rolled back safely/,
    );
  });
});
