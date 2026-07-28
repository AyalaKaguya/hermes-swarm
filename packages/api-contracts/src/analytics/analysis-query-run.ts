import { z } from "zod";
import { DatasetArtifactSchema } from "./dataset-artifact.js";
import { AnalyticsErrorCodeSchema } from "./errors.js";
import {
  AnalyticsSourceKeySchema,
  AnalyticsSourceRevisionSchema,
} from "./primitives.js";
import { AnalysisQuerySchema } from "./query.js";
import { DatasetResultSchema } from "./result.js";

export const ANALYSIS_QUERY_RUN_SCHEMA_VERSION =
  "hermes.analytics.query-run/v1" as const;

export const AnalysisQueryRunStatusSchema = z.enum([
  "cancelled",
  "cancelling",
  "failed",
  "queued",
  "running",
  "succeeded",
  "timedOut",
  "waiting",
]);
export type AnalysisQueryRunStatus = z.infer<
  typeof AnalysisQueryRunStatusSchema
>;

const queryRunDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const queryRunDateTimeSchema = z.iso.datetime({ offset: true });
const queryRunIdempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/);

export const AnalysisQueryRunSchema = z
  .strictObject({
    artifactId: z.uuid().nullable(),
    createdAt: queryRunDateTimeSchema,
    error: z
      .strictObject({
        code: AnalyticsErrorCodeSchema,
        message: z.string().trim().min(1).max(1_000),
      })
      .nullable(),
    expiresAt: queryRunDateTimeSchema,
    finishedAt: queryRunDateTimeSchema.nullable(),
    id: z.uuid(),
    normalizedQuery: AnalysisQuerySchema,
    policyDigest: queryRunDigestSchema.nullable(),
    policyRevision: z.string().trim().min(1).max(128),
    queryDigest: queryRunDigestSchema,
    queuedAt: queryRunDateTimeSchema,
    resultKind: z.enum(["artifact", "inline"]).nullable(),
    schemaVersion: z.literal(ANALYSIS_QUERY_RUN_SCHEMA_VERSION),
    sourceKey: AnalyticsSourceKeySchema,
    sourceRevision: AnalyticsSourceRevisionSchema,
    startedAt: queryRunDateTimeSchema.nullable(),
    status: AnalysisQueryRunStatusSchema,
    updatedAt: queryRunDateTimeSchema,
  })
  .superRefine((run, context) => {
    if (run.sourceKey !== run.normalizedQuery.sourceKey) {
      context.addIssue({
        code: "custom",
        message: "sourceKey must match normalizedQuery.sourceKey",
        path: ["sourceKey"],
      });
    }
    if (run.sourceRevision !== run.normalizedQuery.sourceRevision) {
      context.addIssue({
        code: "custom",
        message: "sourceRevision must match normalizedQuery.sourceRevision",
        path: ["sourceRevision"],
      });
    }

    const terminal = isTerminalStatus(run.status);
    if (terminal !== (run.finishedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "finishedAt must be present exactly for terminal runs",
        path: ["finishedAt"],
      });
    }
    if (
      (run.status === "failed" || run.status === "timedOut") !==
      (run.error !== null)
    ) {
      context.addIssue({
        code: "custom",
        message: "error must be present exactly for failed or timed-out runs",
        path: ["error"],
      });
    }
    if (run.status === "succeeded" && run.policyDigest === null) {
      context.addIssue({
        code: "custom",
        message: "succeeded runs must include policyDigest",
        path: ["policyDigest"],
      });
    }
    if (run.status === "succeeded" && run.resultKind === null) {
      context.addIssue({
        code: "custom",
        message: "succeeded runs must identify their result kind",
        path: ["resultKind"],
      });
    }
    if (run.status !== "succeeded" && run.resultKind !== null) {
      context.addIssue({
        code: "custom",
        message: "only succeeded runs can identify a result",
        path: ["resultKind"],
      });
    }
    if ((run.resultKind === "artifact") !== (run.artifactId !== null)) {
      context.addIssue({
        code: "custom",
        message: "artifact results must identify exactly one artifact",
        path: ["artifactId"],
      });
    }

    const queuedAt = Date.parse(run.queuedAt);
    if (Date.parse(run.createdAt) > queuedAt) {
      context.addIssue({
        code: "custom",
        message: "queuedAt cannot precede createdAt",
        path: ["queuedAt"],
      });
    }
    if (Date.parse(run.updatedAt) < Date.parse(run.createdAt)) {
      context.addIssue({
        code: "custom",
        message: "updatedAt cannot precede createdAt",
        path: ["updatedAt"],
      });
    }
    if (Date.parse(run.expiresAt) <= queuedAt) {
      context.addIssue({
        code: "custom",
        message: "expiresAt must follow queuedAt",
        path: ["expiresAt"],
      });
    }
    for (const field of ["startedAt", "finishedAt"] as const) {
      const value = run[field];
      if (value !== null && Date.parse(value) < queuedAt) {
        context.addIssue({
          code: "custom",
          message: `${field} cannot precede queuedAt`,
          path: [field],
        });
      }
    }
  });
export type AnalysisQueryRun = z.infer<typeof AnalysisQueryRunSchema>;

export const AnalysisQueryRunParamsSchema = z.strictObject({
  runId: z.uuid(),
});
export type AnalysisQueryRunParams = z.infer<
  typeof AnalysisQueryRunParamsSchema
>;

export const CreateAnalysisQueryRunRequestSchema = z.strictObject({
  idempotencyKey: queryRunIdempotencyKeySchema,
  query: AnalysisQuerySchema,
});
export type CreateAnalysisQueryRunRequest = z.infer<
  typeof CreateAnalysisQueryRunRequestSchema
>;

export const AnalysisQueryResultSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("inline"),
    result: DatasetResultSchema,
  }),
  z.strictObject({
    artifact: DatasetArtifactSchema,
    kind: z.literal("artifact"),
  }),
]);
export type AnalysisQueryResult = z.infer<typeof AnalysisQueryResultSchema>;

const queryRunErrorMessageSchema = z.string().trim().min(1).max(2_000);

function queryRunErrorSchema<
  TStatus extends 400 | 404 | 409 | 500 | 503 | 504,
  TCode extends z.ZodType<string>,
>(statusCode: TStatus, code: TCode) {
  return z.strictObject({
    code,
    message: queryRunErrorMessageSchema,
    statusCode: z.literal(statusCode),
  });
}

export const AnalysisQueryRunBadRequestErrorSchema = queryRunErrorSchema(
  400,
  z.enum([
    "ANALYTICS_AGGREGATION_INVALID",
    "ANALYTICS_FIELD_CAPABILITY_DENIED",
    "ANALYTICS_FIELD_UNKNOWN",
    "ANALYTICS_FILTER_INVALID",
    "ANALYTICS_QUERY_BUDGET_EXCEEDED",
    "ANALYTICS_QUERY_INVALID",
    "ANALYTICS_QUERY_RUN_INVALID",
    "ANALYTICS_RESULT_INVALID",
    "ANALYTICS_SOURCE_REVISION_MISMATCH",
  ]),
);
export const AnalysisQueryRunNotFoundErrorSchema = queryRunErrorSchema(
  404,
  z.enum([
    "ANALYTICS_ARTIFACT_NOT_FOUND",
    "ANALYTICS_QUERY_RUN_NOT_FOUND",
    "ANALYTICS_SOURCE_NOT_FOUND",
  ]),
);
export const AnalysisQueryRunConflictErrorSchema = queryRunErrorSchema(
  409,
  z.enum([
    "ANALYTICS_ARTIFACT_NOT_READY",
    "ANALYTICS_QUERY_RUN_IDEMPOTENCY_CONFLICT",
    "ANALYTICS_QUERY_RUN_NOT_READY",
  ]),
);
export const AnalysisQueryRunInternalErrorSchema = queryRunErrorSchema(
  500,
  z.enum([
    "ANALYTICS_ARTIFACT_INVALID",
    "ANALYTICS_CONTEXT_REQUIRED",
    "ANALYTICS_QUERY_RUN_INVALID",
    "ANALYTICS_QUERY_RUN_UNAVAILABLE",
  ]),
);
export const AnalysisQueryRunUnavailableErrorSchema = queryRunErrorSchema(
  503,
  z.enum([
    "ANALYTICS_ADAPTER_UNAVAILABLE",
    "ANALYTICS_ARTIFACT_UNAVAILABLE",
    "ANALYTICS_QUERY_RUN_UNAVAILABLE",
  ]),
);
export const AnalysisQueryRunTimeoutErrorSchema = queryRunErrorSchema(
  504,
  z.literal("ANALYTICS_QUERY_TIMEOUT"),
);

export const AnalysisQueryRunErrorSchema = z.discriminatedUnion("statusCode", [
  AnalysisQueryRunBadRequestErrorSchema,
  AnalysisQueryRunNotFoundErrorSchema,
  AnalysisQueryRunConflictErrorSchema,
  AnalysisQueryRunInternalErrorSchema,
  AnalysisQueryRunUnavailableErrorSchema,
  AnalysisQueryRunTimeoutErrorSchema,
]);
export type AnalysisQueryRunError = z.infer<
  typeof AnalysisQueryRunErrorSchema
>;

function isTerminalStatus(status: AnalysisQueryRunStatus) {
  return (
    status === "cancelled" ||
    status === "failed" ||
    status === "succeeded" ||
    status === "timedOut"
  );
}
