import { z } from "zod";
import { FileObjectPurposeSchema, IdentifierSchema, IsoDateTimeSchema, UuidSchema } from "../models.js";
import { SemanticVersionSchema } from "./common.js";
import { ExecutionScopeSchemaVersionSchema } from "./versions.js";

export const ExecutionBudgetSchema = z.strictObject({
  maxCostMicros: z.number().int().nonnegative(),
  maxDurationMs: z.number().int().min(100).max(24 * 60 * 60 * 1_000),
  maxInputTokens: z.number().int().nonnegative(),
  maxOutputTokens: z.number().int().nonnegative(),
});

export const ResolvedProviderGrantSchema = z.strictObject({
  deploymentId: UuidSchema,
  grantId: UuidSchema,
  revision: z.number().int().positive(),
});

export const ResolvedToolGrantSchema = z.strictObject({
  grantId: UuidSchema,
  toolDefinitionId: UuidSchema,
  version: SemanticVersionSchema,
});

/**
 * Internal trusted context. HTTP bodies and queue payloads must never be parsed
 * directly into this shape; the API/worker reconstruct it from authorized rows.
 */
export const ExecutionScopeSchema = z.strictObject({
  actorAccountId: UuidSchema,
  agentVersionId: UuidSchema,
  allowedFilePurposes: z.array(FileObjectPurposeSchema).max(20),
  budget: ExecutionBudgetSchema,
  cancellationRequested: z.boolean(),
  conversationId: UuidSchema.nullable(),
  correlationId: IdentifierSchema,
  dataClassification: z.enum(["confidential", "internal", "restricted"]),
  deadlineAt: IsoDateTimeSchema,
  idempotencyKey: IdentifierSchema,
  parentRunId: UuidSchema.nullable(),
  providerGrants: z.array(ResolvedProviderGrantSchema).max(100),
  runId: UuidSchema,
  schemaVersion: ExecutionScopeSchemaVersionSchema,
  sessionId: UuidSchema,
  subjectScope: z.enum(["platformForWorkspace", "workspace"]),
  toolGrants: z.array(ResolvedToolGrantSchema).max(500),
  workspaceId: UuidSchema,
}).superRefine((scope, context) => {
  for (const field of ["allowedFilePurposes"] as const) {
    if (new Set(scope[field]).size !== scope[field].length) {
      context.addIssue({ code: "custom", message: `${field} values must be unique`, path: [field] });
    }
  }
  for (const [field, values] of [
    ["providerGrants", scope.providerGrants.map((grant) => grant.grantId)],
    ["toolGrants", scope.toolGrants.map((grant) => grant.grantId)],
  ] as const) {
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: `${field} IDs must be unique`, path: [field] });
    }
  }
});

export type ExecutionBudget = z.infer<typeof ExecutionBudgetSchema>;
export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;
