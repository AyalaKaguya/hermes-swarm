import { z } from "zod";
import { IdentifierSchema } from "../models.js";
import { AiErrorSchemaVersionSchema, AI_ERROR_SCHEMA_VERSION } from "./versions.js";

export const KnownAiErrorCategorySchema = z.enum([
  "authorization",
  "cancelled",
  "configuration",
  "external",
  "internal",
  "invalidInput",
  "notFound",
  "quota",
  "timeout",
]);

export const AI_ERROR_CODES = Object.freeze([
  "AI_AUTHORIZATION_DENIED",
  "AI_CANCELLED",
  "AI_CONFIGURATION_INVALID",
  "AI_CONTRACT_UNSUPPORTED",
  "AI_EXTERNAL_FAILURE",
  "AI_INTERNAL_ERROR",
  "AI_INVALID_INPUT",
  "AI_MODEL_UNAVAILABLE",
  "AI_NOT_FOUND",
  "AI_QUOTA_EXCEEDED",
  "AI_TIMEOUT",
  "AI_TOOL_DENIED",
] as const);
export const KnownAiErrorCodeSchema = z.enum(AI_ERROR_CODES);

// Categories and codes are open identifiers so newer producers do not break
// older readers. The surrounding object stays strict to prevent secret-bearing
// internal error fields from crossing the public boundary.
export const AiErrorCategorySchema = z.string().trim().min(1).max(100)
  .regex(/^[a-z][a-zA-Z0-9_.-]*$/);
export const AiErrorCodeSchema = z.string().trim().min(1).max(160)
  .regex(/^AI_[A-Z0-9][A-Z0-9_.-]*$/);

export const AiErrorSchema = z.strictObject({
  category: AiErrorCategorySchema,
  code: AiErrorCodeSchema,
  correlationId: IdentifierSchema,
  publicMessage: z.string().trim().min(1).max(2_000),
  retryAfterMs: z.number().int().positive().max(24 * 60 * 60 * 1_000).optional(),
  retryable: z.boolean(),
  schemaVersion: AiErrorSchemaVersionSchema,
});

export type AiError = z.infer<typeof AiErrorSchema>;

/** Return only an already-public error; all other values become a safe fallback. */
export function redactAiError(value: unknown, correlationId: string): AiError {
  const parsed = AiErrorSchema.safeParse(value);
  if (parsed.success) return parsed.data;
  return {
    category: "internal",
    code: "AI_INTERNAL_ERROR",
    correlationId: IdentifierSchema.parse(correlationId),
    publicMessage: "The AI operation could not be completed.",
    retryable: false,
    schemaVersion: AI_ERROR_SCHEMA_VERSION,
  };
}
