import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { DataSource, EntityManager } from "typeorm";
import { AnalysisQueryArtifactGcService } from "./analysis-query-artifact-gc.service.js";

describe("AnalysisQueryArtifactGcService", () => {
  it("redacts expired payloads before FileObject garbage collection", async () => {
    const statements: Array<{ parameters: unknown[]; sql: string }> = [];
    const results = [
      [{ id: "inline-1" }],
      [{ id: "artifact-1" }],
      [{ id: "artifact-2" }],
    ];
    const manager = {
      async query(sql: string, parameters: unknown[]) {
        statements.push({ parameters, sql: sql.replace(/\s+/g, " ").trim() });
        return results[statements.length - 1];
      },
    } as unknown as EntityManager;
    const dataSource = {
      transaction: async <T>(work: (value: EntityManager) => Promise<T>) =>
        work(manager),
    } as unknown as DataSource;

    const summary = await new AnalysisQueryArtifactGcService(
      dataSource,
    ).collectExpired(25);

    assert.deepEqual(summary, {
      clearedInlineResults: 1,
      expiredArtifacts: 1,
      removedIncompleteArtifacts: 1,
    });
    assert.equal(statements.length, 3);
    assert.ok(statements.every((statement) => statement.parameters[0] === 25));
    assert.match(statements[0]!.sql, /"inline_result" = NULL/);
    assert.match(statements[1]!.sql, /"file_object_id" = NULL/);
    assert.match(statements[1]!.sql, /"preview" = NULL/);
    assert.match(statements[1]!.sql, /"status" = 'expired'/);
    assert.match(statements[2]!.sql, /"status" IN \('failed', 'pending'\)/);
    assert.match(statements[2]!.sql, /DELETE FROM "dataset_artifacts"/);
    assert.ok(statements.every((statement) => /SKIP LOCKED/.test(statement.sql)));
  });

  it("rejects an unbounded maintenance batch", async () => {
    const service = new AnalysisQueryArtifactGcService({} as DataSource);
    await assert.rejects(() => service.collectExpired(1_001), /between 1 and 1000/);
  });
});
