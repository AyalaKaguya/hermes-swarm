import { Injectable } from "@nestjs/common";
import {
  ANALYTICS_QUERY_TIMEOUT_MS,
  ANALYTICS_RESULT_VERSION,
  DatasetResultSchema,
  type DatasetResult,
} from "@hermes-swarm/api-contracts/analytics";
import { Ticket } from "@hermes-swarm/core";
import {
  SUPPORT_TICKETS_QUERY_DATASET_SCHEMA,
  SUPPORT_TICKETS_QUERY_POLICY_REVISION,
  SupportTicketsQueryError,
  AnalyticsQueryValidationError,
  analyticsDigest,
  executeSupportTicketsQuery,
  expectedAnalysisResultSchema,
  validateAnalysisQueryAgainstDataset,
} from "@hermes-swarm/core/analytics";
import { DataSource } from "typeorm";
import type { AnalyticsQueryExecutor } from "./analytics-query-executor.js";
import {
  AnalyticsQueryRunHandlerError,
  type AuthorizedAnalysisQueryRun,
} from "./analytics-query-run.types.js";

const SUPPORT_TICKETS_QUERY_PERMISSION =
  "analytics.ticket_dataset.query:workspace";

@Injectable()
export class SupportTicketsQueryExecutor implements AnalyticsQueryExecutor {
  constructor(private readonly dataSource: DataSource) {}

  async execute(
    run: AuthorizedAnalysisQueryRun,
    signal: AbortSignal,
  ): Promise<DatasetResult> {
    try {
      if (run.policyRevision !== SUPPORT_TICKETS_QUERY_POLICY_REVISION) {
        throw new AnalyticsQueryValidationError(
          "ANALYTICS_SOURCE_REVISION_MISMATCH",
          "Analytics policy revision has changed.",
        );
      }
      validateAnalysisQueryAgainstDataset(
        run.query,
        SUPPORT_TICKETS_QUERY_DATASET_SCHEMA,
      );
      if (analyticsDigest(run.query) !== run.queryDigest) {
        throw new AnalyticsQueryValidationError(
          "ANALYTICS_QUERY_INVALID",
          "Analytics query digest is invalid.",
        );
      }

      const startedAt = performance.now();
      const adapterResult = await this.dataSource.transaction(
        async (manager) => {
          await manager.query(
            `SET LOCAL statement_timeout = '${ANALYTICS_QUERY_TIMEOUT_MS}ms'`,
          );
          return executeSupportTicketsQuery({
            createQueryBuilder: () =>
              manager.getRepository(Ticket).createQueryBuilder("ticket"),
            query: run.query,
            signal,
            workspaceId: run.workspaceId,
          });
        },
      );
      const expectedSchema = expectedAnalysisResultSchema(
        run.query,
        SUPPORT_TICKETS_QUERY_DATASET_SCHEMA,
      );
      if (analyticsDigest(adapterResult.schema) !== analyticsDigest(expectedSchema)) {
        throw new AnalyticsQueryValidationError(
          "ANALYTICS_RESULT_INVALID",
          "Analytics adapter returned an incompatible result schema.",
        );
      }
      const policyDigest = analyticsDigest({
        actorId: run.actorId,
        integrationTokenId: run.integrationTokenId,
        locale: run.locale,
        permissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
        policyRevision: run.policyRevision,
        principalType: run.principalType,
        requiredPermissions: [SUPPORT_TICKETS_QUERY_PERMISSION],
        scopeLevel: "workspace",
        sourceKey: run.sourceKey,
        sourceRevision: run.sourceRevision,
        timeZone: run.timeZone,
        workspaceId: run.workspaceId,
      });
      const candidate = {
        lineage: {
          generatedAt: new Date().toISOString(),
          policyDigest,
          queryDigest: run.queryDigest,
          sourceKey: run.sourceKey,
          sourceRevision: run.sourceRevision,
        },
        pageInfo: adapterResult.pageInfo,
        rows: adapterResult.rows,
        schema: expectedSchema,
        schemaVersion: ANALYTICS_RESULT_VERSION,
        summary: {
          durationMs: Math.min(
            ANALYTICS_QUERY_TIMEOUT_MS,
            Math.max(0, Math.round(performance.now() - startedAt)),
          ),
          returnedRows: adapterResult.rows.length,
          truncated: adapterResult.truncated,
        },
      };
      const parsed = DatasetResultSchema.safeParse(candidate);
      if (!parsed.success) {
        const tooLarge = Buffer.byteLength(JSON.stringify(candidate), "utf8") >
          2 * 1024 * 1024;
        throw new AnalyticsQueryRunHandlerError(
          tooLarge ? "ANALYTICS_RESULT_TOO_LARGE" : "ANALYTICS_RESULT_INVALID",
          false,
          tooLarge
            ? "Analytics result exceeded the response byte budget."
            : "Analytics adapter returned an invalid result.",
        );
      }
      return parsed.data;
    } catch (error) {
      if (error instanceof AnalyticsQueryRunHandlerError) throw error;
      if (
        error instanceof AnalyticsQueryValidationError ||
        error instanceof SupportTicketsQueryError
      ) {
        throw new AnalyticsQueryRunHandlerError(error.code, false, error.message);
      }
      if (isPostgresStatementTimeout(error)) {
        throw new AnalyticsQueryRunHandlerError(
          "ANALYTICS_QUERY_TIMEOUT",
          false,
          "Analytics query exceeded its execution deadline.",
        );
      }
      if (signal.aborted) throw signal.reason;
      throw new AnalyticsQueryRunHandlerError(
        "ANALYTICS_ADAPTER_UNAVAILABLE",
        true,
        "Analytics source is temporarily unavailable.",
      );
    }
  }
}

function isPostgresStatementTimeout(error: unknown) {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    error.code === "57014"
  );
}
