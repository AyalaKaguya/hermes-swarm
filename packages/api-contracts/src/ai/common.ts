import { z } from "zod";
import { JsonValueSchema } from "../models.js";

export const RuntimeIdentifierSchema = z.string().trim().min(1).max(128)
  .regex(/^[A-Za-z][A-Za-z0-9._:-]*$/, "Expected a stable runtime identifier");

export const SemanticVersionSchema = z.string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/);

export const JsonPointerSchema = z.string().max(512)
  .refine((value) => value === "" || value.startsWith("/"), "Expected an RFC 6901 JSON pointer");

/**
 * A deliberately shallow JSON-schema envelope. Property definitions remain
 * JSON values so the existing OpenAPI 3.0 generator never has to materialize
 * a recursive schema.
 */
export const AiObjectJsonSchema = z.strictObject({
  additionalProperties: z.literal(false),
  properties: z.record(z.string(), JsonValueSchema),
  required: z.array(z.string().min(1)).max(100),
  type: z.literal("object"),
}).superRefine((schema, context) => {
  const seen = new Set<string>();
  for (const [index, name] of schema.required.entries()) {
    if (seen.has(name)) {
      context.addIssue({ code: "custom", message: "Required property names must be unique", path: ["required", index] });
    }
    seen.add(name);
    if (!(name in schema.properties)) {
      context.addIssue({ code: "custom", message: "Required property must exist in properties", path: ["required", index] });
    }
  }
});

export const RuntimeRetryPolicySchema = z.strictObject({
  backoffMs: z.number().int().min(0).max(60_000),
  maxAttempts: z.number().int().min(1).max(5),
  strategy: z.enum(["fixed", "exponential"]),
});

export type AiObjectJson = z.infer<typeof AiObjectJsonSchema>;
export type RuntimeRetryPolicy = z.infer<typeof RuntimeRetryPolicySchema>;
