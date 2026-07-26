import type {
  AnalysisQuery,
  DatasetResult,
  DatasetResultLineage,
  DatasetResultRow,
  DatasetResultField,
} from "@hermes-swarm/api-contracts/analytics";
import type { RunHandlerContext } from "@hermes-swarm/agent-sdk";

export const ANALYTICS_QUERY_RUN_STORE = Symbol("ANALYTICS_QUERY_RUN_STORE");

export const ANALYTICS_QUERY_RUN_KIND = "analytics.query" as const;
export const ANALYTICS_QUERY_INLINE_MAX_BYTES = 256 * 1024;

export type AuthorizedAnalysisQueryRun = Readonly<{
  actorId: string;
  integrationTokenId: string | null;
  locale: string;
  policyRevision: string;
  principalType: "integration" | "workspace";
  query: AnalysisQuery;
  queryDigest: string;
  requestId: string;
  sourceKey: string;
  sourceRevision: string;
  timeZone: string;
  workspaceId: string;
}>;

export type PreparedAnalysisQueryRun =
  | Readonly<{ kind: "already-succeeded" }>
  | Readonly<{ kind: "execute"; run: AuthorizedAnalysisQueryRun }>;

export type AnalyticsArtifactReservation = Readonly<{
  artifactId: string;
  bucket: string;
  fileObjectId: string;
  objectKey: string;
}>;

export type AnalyticsArtifactCandidate = Readonly<{
  byteSize: number;
  lineage: DatasetResultLineage;
  preview: readonly DatasetResultRow[];
  resultSchema: readonly DatasetResultField[];
  rowCount: number;
  sha256: string;
}>;

export interface AnalyticsQueryRunStore {
  completeArtifact(
    context: RunHandlerContext,
    input: AnalyticsArtifactCandidate &
      Readonly<{
        artifactId: string;
        etag: string | null;
        fileObjectId: string;
      }>,
  ): Promise<void>;
  completeInline(
    context: RunHandlerContext,
    input: Readonly<{
      policyDigest: string;
      result: DatasetResult;
    }>,
  ): Promise<void>;
  hasRemainingAttempts(context: RunHandlerContext): boolean;
  prepare(context: RunHandlerContext): Promise<PreparedAnalysisQueryRun>;
  reserveArtifact(
    context: RunHandlerContext,
    input: AnalyticsArtifactCandidate & Readonly<{ bucket: string }>,
  ): Promise<AnalyticsArtifactReservation>;
  settleFailure(
    context: RunHandlerContext,
    input: Readonly<{
      errorCode: string | null;
      status: "cancelled" | "failed" | "timedOut";
    }>,
  ): Promise<void>;
}

export class AnalyticsQueryRunHandlerError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    message: string,
  ) {
    super(message);
    this.name = "AnalyticsQueryRunHandlerError";
  }
}
