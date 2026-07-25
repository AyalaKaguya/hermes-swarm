import type {
  AnalysisQuery,
  DatasetCellValue,
  DatasetResultField,
  DatasetSchema,
} from "@hermes-swarm/api-contracts/analytics";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";

export type AnalyticsScalar = DatasetCellValue;

export type AnalyticsAuthorizationContext = Readonly<{
  actorId: string;
  locale: string;
  permissions: ReadonlySet<string>;
  principalType: "integration" | "workspace";
  requestId: string;
  timeZone: string;
}>;

/**
 * Trusted execution context assembled by the API. None of these values are
 * accepted from an AnalysisQuery or an HTTP request body.
 */
export type AnalyticsExecutionContext = AnalyticsAuthorizationContext &
  Readonly<{
    scopeLevel: RequestScopeLevel;
    workspaceId: string;
  }>;

export type AnalyticsResultColumn = Readonly<DatasetResultField>;

/**
 * Adapter-owned portion of a result. The gateway supplies duration and
 * lineage so adapters cannot forge policy or query digests.
 */
export type AnalyticsAdapterResult = Readonly<{
  pageInfo: Readonly<{
    hasMore: boolean;
    nextCursor: string | null;
  }>;
  rows: ReadonlyArray<Readonly<Record<string, AnalyticsScalar>>>;
  schema: ReadonlyArray<AnalyticsResultColumn>;
  truncated?: boolean;
}>;

export interface AnalyticsSourceAdapter {
  readonly kind: string;

  describe(
    context: AnalyticsExecutionContext,
    sourceKey: string,
    signal: AbortSignal,
  ): Promise<DatasetSchema>;

  execute(
    context: AnalyticsExecutionContext,
    query: AnalysisQuery,
    signal: AbortSignal,
  ): Promise<AnalyticsAdapterResult>;
}

export type AnalyticsSourceRegistration = Readonly<{
  adapter: AnalyticsSourceAdapter;
  policyRevision: string;
  requiredPermissions: readonly string[];
  sourceKey: string;
}>;
