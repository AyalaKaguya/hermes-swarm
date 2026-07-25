import { z } from "zod";
import { IdentifierSchema, IsoDateTimeSchema, UuidSchema } from "../models.js";
import { RuntimeIdentifierSchema, SemanticVersionSchema } from "./common.js";
import { AiErrorSchema } from "./errors.js";
import { ModelCapabilitySchema } from "./model-reference.js";
import { RunEventSchemaVersionSchema } from "./versions.js";

export const RunStatusSchema = z.enum([
  "cancelled",
  "cancelling",
  "failed",
  "queued",
  "running",
  "succeeded",
  "timedOut",
  "waiting",
]);

export const RUN_EVENT_ERROR_CODES = {
  invalidCursor: "AI_RUN_EVENT_CURSOR_INVALID",
  runUnavailable: "AI_RUN_UNAVAILABLE",
} as const;

const MAX_RUN_EVENT_SEQUENCE = 2_147_483_647;

export const RunEventSequenceSchema = z
  .number()
  .int()
  .nonnegative()
  .max(MAX_RUN_EVENT_SEQUENCE);

export const RunEventParamsSchema = z.strictObject({
  runId: UuidSchema,
});

export const RunEventHistoryQuerySchema = z.strictObject({
  afterSequence: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(MAX_RUN_EVENT_SEQUENCE)
    .default(0),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const RunEventStreamQuerySchema = z.strictObject({
  afterSequence: z.coerce
    .number()
    .int()
    .nonnegative()
    .max(MAX_RUN_EVENT_SEQUENCE)
    .optional(),
});

export const RunEventStreamHeadersSchema = z.strictObject({
  "Last-Event-ID": z.string().optional(),
});

const eventEnvelope = {
  callId: UuidSchema.nullable(),
  eventKey: RuntimeIdentifierSchema,
  id: UuidSchema,
  nodeId: RuntimeIdentifierSchema.nullable(),
  occurredAt: IsoDateTimeSchema,
  runId: UuidSchema,
  schemaVersion: RunEventSchemaVersionSchema,
  sequence: RunEventSequenceSchema.positive(),
  workspaceId: UuidSchema,
};

const RunStartedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ agentVersionId: UuidSchema, status: z.literal("running") }),
  type: z.literal("run.started"),
});

export const RunStatusChangedEventSchema = z.strictObject({
  ...eventEnvelope,
  callId: z.null(),
  nodeId: z.null(),
  payload: z
    .strictObject({
      from: RunStatusSchema,
      reasonCode: RuntimeIdentifierSchema.nullable(),
      to: RunStatusSchema,
    })
    .refine((status) => status.from !== status.to, {
      message: "Run status transition must change status",
      path: ["to"],
    }),
  type: z.literal("run.status.changed"),
});

const NodeStartedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ attempt: z.number().int().positive(), nodeType: z.enum(["condition", "end", "model", "tool"]) }),
  type: z.literal("node.started"),
});

const NodeCompletedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ attempt: z.number().int().positive(), durationMs: z.number().int().nonnegative() }),
  type: z.literal("node.completed"),
});

const NodeFailedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ attempt: z.number().int().positive(), error: AiErrorSchema }),
  type: z.literal("node.failed"),
});

const ModelOutputDeltaEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ finishReason: RuntimeIdentifierSchema.nullable(), index: z.number().int().nonnegative(), text: z.string() }),
  type: z.literal("model.output.delta"),
});

const ToolCallStartedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ toolDefinitionId: UuidSchema, toolVersion: SemanticVersionSchema }),
  type: z.literal("tool.call.started"),
});

const ToolCallCompletedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ durationMs: z.number().int().nonnegative(), outcome: z.enum(["failed", "succeeded"]), toolDefinitionId: UuidSchema }),
  type: z.literal("tool.call.completed"),
});

const ArtifactCreatedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({
    artifactId: UuidSchema,
    artifactType: z.enum(["chart", "file", "json", "table", "text"]),
    fileObjectId: UuidSchema.nullable(),
    title: z.string().max(500),
  }),
  type: z.literal("artifact.created"),
});

const CheckpointCreatedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ checkpointId: UuidSchema, checkpointSequence: z.number().int().positive() }),
  type: z.literal("checkpoint.created"),
});

const UsageRecordedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({
    capability: ModelCapabilitySchema,
    costMicros: z.number().int().nonnegative(),
    currency: z.string().length(3).transform((value) => value.toUpperCase()),
    deploymentId: UuidSchema,
    deploymentRevision: z.number().int().positive(),
    inputTokens: z.number().int().nonnegative(),
    latencyMs: z.number().int().nonnegative(),
    modelId: IdentifierSchema,
    outputTokens: z.number().int().nonnegative(),
    providerId: UuidSchema,
    totalTokens: z.number().int().nonnegative(),
  }).superRefine((usage, context) => {
    if (usage.totalTokens !== usage.inputTokens + usage.outputTokens) {
      context.addIssue({ code: "custom", message: "Total tokens must equal input plus output tokens", path: ["totalTokens"] });
    }
  }),
  type: z.literal("usage.recorded"),
});

const CancellationRequestedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ reason: z.enum(["deadline", "featureDisabled", "user"]), requestedByAccountId: UuidSchema.nullable() }),
  type: z.literal("run.cancellation.requested"),
});

const RunFailedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ error: AiErrorSchema, status: z.enum(["failed", "timedOut"]) }),
  type: z.literal("run.failed"),
});

const RunCompletedEventSchema = z.strictObject({
  ...eventEnvelope,
  payload: z.strictObject({ artifactIds: z.array(UuidSchema).max(1_000), status: z.enum(["cancelled", "succeeded"]) }),
  type: z.literal("run.completed"),
});

export const RunEventSchema = z.discriminatedUnion("type", [
  RunStartedEventSchema,
  RunStatusChangedEventSchema,
  NodeStartedEventSchema,
  NodeCompletedEventSchema,
  NodeFailedEventSchema,
  ModelOutputDeltaEventSchema,
  ToolCallStartedEventSchema,
  ToolCallCompletedEventSchema,
  ArtifactCreatedEventSchema,
  CheckpointCreatedEventSchema,
  UsageRecordedEventSchema,
  CancellationRequestedEventSchema,
  RunFailedEventSchema,
  RunCompletedEventSchema,
]);

export const RunEventHistoryPageSchema = z.strictObject({
  eventSequence: RunEventSequenceSchema,
  hasMore: z.boolean(),
  items: z.array(RunEventSchema).max(200),
  nextAfterSequence: RunEventSequenceSchema.nullable(),
  runStatus: RunStatusSchema,
});

export const RunEventCursorBadRequestErrorSchema = z.strictObject({
  code: z.literal(RUN_EVENT_ERROR_CODES.invalidCursor),
  message: z.string().trim().min(1).max(2_000),
  statusCode: z.literal(400),
});

export const RunUnavailableNotFoundErrorSchema = z.strictObject({
  code: z.literal(RUN_EVENT_ERROR_CODES.runUnavailable),
  message: z.string().trim().min(1).max(2_000),
  statusCode: z.literal(404),
});

export type RunStatus = z.infer<typeof RunStatusSchema>;
export type RunEvent = z.infer<typeof RunEventSchema>;
export type RunEventHistoryPage = z.infer<typeof RunEventHistoryPageSchema>;
export type RunEventHistoryQuery = z.infer<typeof RunEventHistoryQuerySchema>;
export type RunEventStreamQuery = z.infer<typeof RunEventStreamQuerySchema>;
