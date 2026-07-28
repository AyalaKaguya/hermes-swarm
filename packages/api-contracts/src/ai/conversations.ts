import { z } from "zod";
import {
  IsoDateTimeSchema,
  JsonValueSchema,
  UuidSchema,
} from "../models.js";
import { RuntimeIdentifierSchema } from "./common.js";
import { RunStatusSchema } from "./run-events.js";

export const AI_CONVERSATION_SCHEMA_VERSION =
  "hermes.ai-conversation/v1" as const;
export const AI_MESSAGE_SCHEMA_VERSION = "hermes.ai-message/v1" as const;
export const AI_ARTIFACT_SCHEMA_VERSION = "hermes.ai-artifact/v1" as const;
export const AGENT_EXECUTION_REQUEST_SCHEMA_VERSION =
  "hermes.agent-execution-request/v1" as const;

export const AiConversationStatusSchema = z.enum(["active", "archived"]);
export const AiMessageRoleSchema = z.enum(["assistant", "user"]);
export const AiMessageStatusSchema = z.union([
  z.literal("completed"),
  RunStatusSchema,
]);
export const AiArtifactTypeSchema = z.enum([
  "chart",
  "file",
  "json",
  "table",
  "text",
]);
export const AiArtifactStatusSchema = z.enum(["failed", "pending", "ready"]);

const messageContentSchema = z.string().max(100_000);
const attachmentIdsSchema = z
  .array(UuidSchema)
  .max(20)
  .default([])
  .superRefine((values, context) => {
    const seen = new Set<string>();
    values.forEach((value, index) => {
      if (seen.has(value)) {
        context.addIssue({
          code: "custom",
          message: "Attachment FileObject IDs must be unique",
          path: [index],
        });
      }
      seen.add(value);
    });
  });

export const AiConversationMessageInputSchema = z
  .strictObject({
    content: messageContentSchema.default(""),
    fileIds: attachmentIdsSchema,
  })
  .refine(
    ({ content, fileIds }) => content.trim().length > 0 || fileIds.length > 0,
    { message: "A message must include content or at least one attachment" },
  );

export const CreateAiConversationRequestSchema = z.strictObject({
  agentVersionId: UuidSchema,
  clientRequestId: UuidSchema,
  message: AiConversationMessageInputSchema,
});

export const SendAiConversationMessageRequestSchema = z.strictObject({
  clientRequestId: UuidSchema,
  message: AiConversationMessageInputSchema,
});

export const AiConversationSchema = z.strictObject({
  agentVersionId: UuidSchema,
  createdAt: IsoDateTimeSchema,
  id: UuidSchema,
  lastMessageAt: IsoDateTimeSchema.nullable(),
  messageSequence: z.number().int().nonnegative(),
  schemaVersion: z.literal(AI_CONVERSATION_SCHEMA_VERSION),
  status: AiConversationStatusSchema,
  title: z.string().max(240),
  updatedAt: IsoDateTimeSchema,
});

export const AiMessageFileSchema = z.strictObject({
  byteSize: z.number().int().nonnegative(),
  fileId: UuidSchema,
  mimeType: z.string().trim().min(1).max(160),
  originalName: z.string().trim().min(1).max(240),
});

const messageEnvelope = {
  attachments: z.array(AiMessageFileSchema).max(20),
  conversationId: UuidSchema,
  createdAt: IsoDateTimeSchema,
  id: UuidSchema,
  schemaVersion: z.literal(AI_MESSAGE_SCHEMA_VERSION),
  sequence: z.number().int().positive(),
  updatedAt: IsoDateTimeSchema,
} as const;

export const AiUserMessageSchema = z.strictObject({
  ...messageEnvelope,
  content: messageContentSchema,
  finishedAt: IsoDateTimeSchema,
  replyToMessageId: z.null(),
  role: z.literal("user"),
  runId: z.null(),
  startedAt: z.null(),
  status: z.literal("completed"),
});

export const AiAssistantMessageSchema = z
  .strictObject({
    ...messageEnvelope,
    content: messageContentSchema.nullable(),
    errorCode: z
      .string()
      .regex(/^AI_[A-Z0-9][A-Z0-9_.-]*$/)
      .max(160)
      .nullable(),
    finishedAt: IsoDateTimeSchema.nullable(),
    replyToMessageId: UuidSchema,
    role: z.literal("assistant"),
    runId: UuidSchema,
    startedAt: IsoDateTimeSchema.nullable(),
    status: RunStatusSchema,
  })
  .superRefine((message, context) => {
    const terminal = new Set(["cancelled", "failed", "succeeded", "timedOut"]);
    if (terminal.has(message.status) !== (message.finishedAt !== null)) {
      context.addIssue({
        code: "custom",
        message: "finishedAt must be present exactly for terminal messages",
        path: ["finishedAt"],
      });
    }
    if (message.status === "succeeded" && message.content === null) {
      context.addIssue({
        code: "custom",
        message: "Succeeded assistant messages must contain final content",
        path: ["content"],
      });
    }
    if (message.status === "queued" && message.content !== null) {
      context.addIssue({
        code: "custom",
        message: "Queued assistant messages cannot contain output",
        path: ["content"],
      });
    }
    const failed = message.status === "failed" || message.status === "timedOut";
    if (failed !== (message.errorCode !== null)) {
      context.addIssue({
        code: "custom",
        message: "Only failed or timed-out messages contain an error code",
        path: ["errorCode"],
      });
    }
  });

export const AiMessageSchema = z.discriminatedUnion("role", [
  AiAssistantMessageSchema,
  AiUserMessageSchema,
]);

export const AgentExecutionSummarySchema = z.strictObject({
  agentVersionId: UuidSchema,
  clientRequestId: UuidSchema,
  createdAt: IsoDateTimeSchema,
  outputNodeId: RuntimeIdentifierSchema,
  runId: UuidSchema,
  status: RunStatusSchema,
});

export const AiConversationSubmissionSchema = z.strictObject({
  conversation: AiConversationSchema,
  deduplicated: z.boolean(),
  execution: AgentExecutionSummarySchema,
  requestMessage: AiUserMessageSchema,
  responseMessage: AiAssistantMessageSchema,
});

export const AiArtifactSchema = z
  .strictObject({
    content: JsonValueSchema.nullable(),
    conversationId: UuidSchema,
    createdAt: IsoDateTimeSchema,
    downloadAvailable: z.boolean(),
    failedAt: IsoDateTimeSchema.nullable(),
    failureCode: z.string().trim().min(1).max(160).nullable(),
    id: UuidSchema,
    messageId: UuidSchema,
    readyAt: IsoDateTimeSchema.nullable(),
    schemaVersion: z.literal(AI_ARTIFACT_SCHEMA_VERSION),
    status: AiArtifactStatusSchema,
    title: z.string().trim().min(1).max(500),
    type: AiArtifactTypeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine((artifact, context) => {
    if (artifact.status === "ready" && artifact.readyAt === null) {
      context.addIssue({
        code: "custom",
        message: "Ready artifacts must include readyAt",
        path: ["readyAt"],
      });
    }
    const failed = artifact.status === "failed";
    if (failed !== (artifact.failedAt !== null && artifact.failureCode !== null)) {
      context.addIssue({
        code: "custom",
        message: "Failed artifacts must include failure details",
        path: ["failureCode"],
      });
    }
    if (artifact.downloadAvailable && artifact.status !== "ready") {
      context.addIssue({
        code: "custom",
        message: "Only ready artifacts can be downloaded",
        path: ["downloadAvailable"],
      });
    }
  });

export const AiConversationParamsSchema = z.strictObject({
  conversationId: UuidSchema,
});
export const AiConversationMessageParamsSchema = z.strictObject({
  conversationId: UuidSchema,
  messageId: UuidSchema,
});
export const AiConversationArtifactParamsSchema = z.strictObject({
  artifactId: UuidSchema,
  conversationId: UuidSchema,
});

export const AI_CONVERSATION_ERROR_CODES = {
  agentGraphUnsupported: "AI_CONVERSATION_AGENT_GRAPH_UNSUPPORTED",
  agentVersionUnavailable: "AI_CONVERSATION_AGENT_VERSION_UNAVAILABLE",
  attachmentInvalid: "AI_CONVERSATION_ATTACHMENT_INVALID",
  idempotencyConflict: "AI_CONVERSATION_IDEMPOTENCY_CONFLICT",
  invalid: "AI_CONVERSATION_INVALID",
  invariant: "AI_CONVERSATION_INVARIANT_VIOLATION",
  notFound: "AI_CONVERSATION_NOT_FOUND",
  principalUnsupported: "AI_CONVERSATION_PRINCIPAL_UNSUPPORTED",
} as const;

export type AiConversation = z.infer<typeof AiConversationSchema>;
export type AiMessage = z.infer<typeof AiMessageSchema>;
export type AiUserMessage = z.infer<typeof AiUserMessageSchema>;
export type AiAssistantMessage = z.infer<typeof AiAssistantMessageSchema>;
export type AiArtifact = z.infer<typeof AiArtifactSchema>;
export type AgentExecutionSummary = z.infer<
  typeof AgentExecutionSummarySchema
>;
export type AiConversationMessageInput = z.infer<
  typeof AiConversationMessageInputSchema
>;
export type CreateAiConversationRequest = z.infer<
  typeof CreateAiConversationRequestSchema
>;
export type SendAiConversationMessageRequest = z.infer<
  typeof SendAiConversationMessageRequestSchema
>;
export type AiConversationSubmission = z.infer<
  typeof AiConversationSubmissionSchema
>;
