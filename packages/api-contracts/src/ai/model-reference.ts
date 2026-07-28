import { z } from "zod";
import { IdentifierSchema, UuidSchema } from "../models.js";
import { AiApiVersionSchema } from "./versions.js";

export const ModelCapabilitySchema = z.enum([
  "chat",
  "embedding",
  "rerank",
  "speechToText",
  "textToSpeech",
]);

export const ModelReferenceSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  capability: ModelCapabilitySchema,
  deploymentId: UuidSchema,
  modelId: IdentifierSchema,
  providerScope: z.enum(["platform", "workspace"]),
});

const WorkspaceDefaultModelBindingSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  capability: ModelCapabilitySchema,
  mode: z.literal("workspaceDefault"),
});

const PinnedModelBindingSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  mode: z.literal("pinned"),
  model: ModelReferenceSchema,
});

const RequestOverrideFallbackSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("workspaceDefault") }),
  z.strictObject({ mode: z.literal("pinned"), model: ModelReferenceSchema }),
]);

const RequestOverrideModelBindingSchema = z.strictObject({
  allowedModels: z.array(ModelReferenceSchema).min(1).max(100),
  apiVersion: AiApiVersionSchema,
  capability: ModelCapabilitySchema,
  fallback: RequestOverrideFallbackSchema,
  mode: z.literal("requestOverride"),
}).superRefine((binding, context) => {
  const allowedModelKeys = new Set<string>();
  for (const [index, model] of binding.allowedModels.entries()) {
    const key = `${model.deploymentId}:${model.modelId}`;
    if (allowedModelKeys.has(key)) {
      context.addIssue({
        code: "custom",
        message: "Allowed models must be unique by deployment and model ID",
        path: ["allowedModels", index],
      });
    }
    allowedModelKeys.add(key);
    if (model.capability !== binding.capability) {
      context.addIssue({
        code: "custom",
        message: "Allowed model capability must match the binding capability",
        path: ["allowedModels", index, "capability"],
      });
    }
  }
  if (binding.fallback.mode === "pinned" && binding.fallback.model.capability !== binding.capability) {
    context.addIssue({
      code: "custom",
      message: "Fallback model capability must match the binding capability",
      path: ["fallback", "model", "capability"],
    });
  }
});

export const ModelBindingSchema = z.union([
  WorkspaceDefaultModelBindingSchema,
  PinnedModelBindingSchema,
  RequestOverrideModelBindingSchema,
]);

export type ModelCapability = z.infer<typeof ModelCapabilitySchema>;
export type ModelReference = z.infer<typeof ModelReferenceSchema>;
export type ModelBinding = z.infer<typeof ModelBindingSchema>;
