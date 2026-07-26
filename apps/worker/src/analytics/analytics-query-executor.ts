import type { DatasetResult } from "@hermes-swarm/api-contracts/analytics";
import type { AuthorizedAnalysisQueryRun } from "./analytics-query-run.types.js";

export const ANALYTICS_QUERY_EXECUTOR = Symbol("ANALYTICS_QUERY_EXECUTOR");

export interface AnalyticsQueryExecutor {
  execute(
    run: AuthorizedAnalysisQueryRun,
    signal: AbortSignal,
  ): Promise<DatasetResult>;
}
