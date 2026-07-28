import { Injectable } from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";

export type AnalysisQueryArtifactGcSummary = Readonly<{
  clearedInlineResults: number;
  expiredArtifacts: number;
  removedIncompleteArtifacts: number;
}>;

@Injectable()
export class AnalysisQueryArtifactGcService {
  constructor(private readonly dataSource: DataSource) {}

  async collectExpired(limit = 100): Promise<AnalysisQueryArtifactGcSummary> {
    const batchSize = normalizeBatchSize(limit);
    return this.dataSource.transaction(async (manager) => ({
      clearedInlineResults: await clearExpiredInlineResults(manager, batchSize),
      expiredArtifacts: await expireReadyArtifacts(manager, batchSize),
      removedIncompleteArtifacts: await removeIncompleteArtifacts(
        manager,
        batchSize,
      ),
    }));
  }
}

async function expireReadyArtifacts(manager: EntityManager, limit: number) {
  const rows = (await manager.query(
    `WITH database_clock AS MATERIALIZED (
       SELECT clock_timestamp() AS "now"
     ), candidates AS MATERIALIZED (
       SELECT artifact."id"
       FROM "dataset_artifacts" artifact
       CROSS JOIN database_clock
       WHERE artifact."status" = 'ready'
         AND artifact."expires_at" <= database_clock."now"
       ORDER BY artifact."expires_at", artifact."id"
       LIMIT $1
       FOR UPDATE OF artifact SKIP LOCKED
     )
     UPDATE "dataset_artifacts" artifact
     SET
       "file_object_id" = NULL,
       "preview" = NULL,
       "status" = 'expired',
       "updated_at" = database_clock."now"
     FROM candidates
     CROSS JOIN database_clock
     WHERE artifact."id" = candidates."id"
     RETURNING artifact."id"`,
    [limit],
  )) as Array<{ id: unknown }>;
  return rows.length;
}

async function removeIncompleteArtifacts(manager: EntityManager, limit: number) {
  const rows = (await manager.query(
    `WITH database_clock AS MATERIALIZED (
       SELECT clock_timestamp() AS "now"
     ), candidates AS MATERIALIZED (
       SELECT artifact."id"
       FROM "dataset_artifacts" artifact
       CROSS JOIN database_clock
       WHERE artifact."status" IN ('failed', 'pending')
         AND artifact."expires_at" <= database_clock."now"
       ORDER BY artifact."expires_at", artifact."id"
       LIMIT $1
       FOR UPDATE OF artifact SKIP LOCKED
     )
     DELETE FROM "dataset_artifacts" artifact
     USING candidates
     WHERE artifact."id" = candidates."id"
     RETURNING artifact."id"`,
    [limit],
  )) as Array<{ id: unknown }>;
  return rows.length;
}

async function clearExpiredInlineResults(manager: EntityManager, limit: number) {
  const rows = (await manager.query(
    `WITH database_clock AS MATERIALIZED (
       SELECT clock_timestamp() AS "now"
     ), candidates AS MATERIALIZED (
       SELECT query_run."id"
       FROM "analysis_query_runs" query_run
       CROSS JOIN database_clock
       WHERE query_run."inline_result" IS NOT NULL
         AND query_run."expires_at" <= database_clock."now"
       ORDER BY query_run."expires_at", query_run."id"
       LIMIT $1
       FOR UPDATE OF query_run SKIP LOCKED
     )
     UPDATE "analysis_query_runs" query_run
     SET
       "inline_result" = NULL,
       "updated_at" = database_clock."now"
     FROM candidates
     CROSS JOIN database_clock
     WHERE query_run."id" = candidates."id"
     RETURNING query_run."id"`,
    [limit],
  )) as Array<{ id: unknown }>;
  return rows.length;
}

function normalizeBatchSize(value: number) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 1_000) {
    throw new Error("Analytics artifact GC limit must be between 1 and 1000");
  }
  return value;
}
