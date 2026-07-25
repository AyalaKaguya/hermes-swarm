import { z } from "zod";
import { IdentifierSchema, UuidSchema } from "../models.js";
import {
  AiObjectJsonSchema,
  JsonPointerSchema,
  RuntimeIdentifierSchema,
  RuntimeRetryPolicySchema,
  SemanticVersionSchema,
} from "./common.js";
import { ToolDefinitionSchemaVersionSchema } from "./versions.js";

export const ToolDriverTypeSchema = z.enum(["internal", "http", "mcpStreamableHttp"]);
export const ToolSideEffectSchema = z.enum(["none", "reversible", "irreversible"]);
export const ToolIdempotencySchema = z.enum(["notRequired", "required", "unsupported"]);

export const ToolReferenceSchema = z.strictObject({
  toolDefinitionId: UuidSchema,
  version: SemanticVersionSchema,
});

export const ToolDefinitionSchema = z.strictObject({
  allowsArtifact: z.boolean(),
  connectionId: UuidSchema.optional(),
  description: z.string().trim().min(1).max(2_000),
  driverType: ToolDriverTypeSchema,
  id: UuidSchema,
  idempotency: ToolIdempotencySchema,
  inputSchema: AiObjectJsonSchema,
  maxResponseBytes: z.number().int().min(1_024).max(10 * 1024 * 1024),
  name: RuntimeIdentifierSchema,
  networkPolicyIds: z.array(IdentifierSchema).max(20),
  outputRedactionPaths: z.array(JsonPointerSchema).max(100),
  outputSchema: AiObjectJsonSchema,
  requiredPermissions: z.array(IdentifierSchema).max(100),
  retry: RuntimeRetryPolicySchema,
  schemaVersion: ToolDefinitionSchemaVersionSchema,
  sideEffect: ToolSideEffectSchema,
  timeoutMs: z.number().int().min(100).max(120_000),
  version: SemanticVersionSchema,
}).superRefine((tool, context) => {
  if (tool.driverType === "internal" && (tool.connectionId !== undefined || tool.networkPolicyIds.length > 0)) {
    context.addIssue({
      code: "custom",
      message: "Internal tools cannot declare external connection or network policy references",
      path: ["driverType"],
    });
  }
  if (tool.driverType !== "internal" && tool.connectionId === undefined) {
    context.addIssue({ code: "custom", message: "External tools require a controlled connection reference", path: ["connectionId"] });
  }
  if (tool.sideEffect === "none" && tool.idempotency !== "notRequired") {
    context.addIssue({ code: "custom", message: "Side-effect-free tools do not require idempotency", path: ["idempotency"] });
  }
  if (tool.sideEffect !== "none" && tool.idempotency === "notRequired") {
    context.addIssue({ code: "custom", message: "Tools with side effects must declare an idempotency policy", path: ["idempotency"] });
  }
  if (tool.retry.maxAttempts > 1 && tool.idempotency === "unsupported") {
    context.addIssue({ code: "custom", message: "Non-idempotent tools cannot be retried automatically", path: ["retry", "maxAttempts"] });
  }
  for (const field of ["networkPolicyIds", "outputRedactionPaths", "requiredPermissions"] as const) {
    const values = tool[field];
    if (new Set(values).size !== values.length) {
      context.addIssue({ code: "custom", message: `${field} values must be unique`, path: [field] });
    }
  }
});

export type ToolReference = z.infer<typeof ToolReferenceSchema>;
export type ToolDefinition = z.infer<typeof ToolDefinitionSchema>;
