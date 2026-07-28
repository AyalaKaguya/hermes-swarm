import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "../models.js";
import { AgentGraphSchema, type AgentGraph } from "./agent-graph.js";
import {
  ModelReferenceSchema,
  type ModelReference,
} from "./model-reference.js";
import {
  ToolReferenceSchema,
  type ToolReference,
} from "./tool-definition.js";
import { AiApiVersionSchema } from "./versions.js";

export const AgentStatusSchema = z.enum(["active", "archived"]);

const AgentNameSchema = z.string().trim().min(1).max(120);
const AgentDescriptionSchema = z.string().trim().max(2_000);
const PositiveRevisionSchema = z.number().int().min(1);
const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);

const AgentDefinitionFields = {
  graph: AgentGraphSchema,
  modelReferences: z.array(ModelReferenceSchema).max(100),
  toolReferences: z.array(ToolReferenceSchema).max(500),
} as const;

/**
 * The complete executable definition stored in a Draft or immutable Version.
 * Declared references must be the exact credential-free references used by the
 * graph so callers cannot smuggle endpoint or secret material beside it.
 */
export const AgentDefinitionSchema = z
  .strictObject(AgentDefinitionFields)
  .superRefine(validateAgentDefinition);

export const AgentSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  createdAt: IsoDateTimeSchema,
  description: AgentDescriptionSchema,
  id: UuidSchema,
  latestVersion: z.number().int().nonnegative(),
  name: AgentNameSchema,
  revision: PositiveRevisionSchema,
  status: AgentStatusSchema,
  updatedAt: IsoDateTimeSchema,
});

export const AgentDraftSchema = z
  .strictObject({
    agentId: UuidSchema,
    apiVersion: AiApiVersionSchema,
    createdAt: IsoDateTimeSchema,
    revision: PositiveRevisionSchema,
    updatedAt: IsoDateTimeSchema,
    ...AgentDefinitionFields,
  })
  .superRefine(validateAgentDefinition);

export const AgentVersionSummarySchema = z.strictObject({
  agentId: UuidSchema,
  apiVersion: AiApiVersionSchema,
  contentDigest: Sha256DigestSchema,
  draftRevision: PositiveRevisionSchema,
  id: UuidSchema,
  publishedAt: IsoDateTimeSchema,
  version: PositiveRevisionSchema,
});

export const AgentVersionSchema = z
  .strictObject({
    ...AgentVersionSummarySchema.shape,
    ...AgentDefinitionFields,
  })
  .superRefine(validateAgentDefinition);

export const CreateAgentRequestSchema = z
  .strictObject({
    description: AgentDescriptionSchema.default(""),
    name: AgentNameSchema,
    status: AgentStatusSchema.default("active"),
    ...AgentDefinitionFields,
  })
  .superRefine(validateAgentDefinition);

export const UpdateAgentRequestSchema = z
  .strictObject({
    description: AgentDescriptionSchema.optional(),
    expectedRevision: PositiveRevisionSchema,
    name: AgentNameSchema.optional(),
    status: AgentStatusSchema.optional(),
  })
  .refine(
    ({ description, name, status }) =>
      description !== undefined || name !== undefined || status !== undefined,
    "At least one Agent field is required",
  );

export const ReplaceAgentDraftRequestSchema = z
  .strictObject({
    expectedRevision: PositiveRevisionSchema,
    ...AgentDefinitionFields,
  })
  .superRefine(validateAgentDefinition);

/** PUT replaces the complete Draft; this alias keeps mutation naming stable. */
export const UpdateAgentDraftRequestSchema = ReplaceAgentDraftRequestSchema;

export const PublishAgentDraftRequestSchema = z.strictObject({
  expectedRevision: PositiveRevisionSchema,
});

export const AGENT_CATALOG_ERROR_CODES = {
  archived: "AI_AGENT_ARCHIVED",
  definitionInvalid: "AI_AGENT_DEFINITION_INVALID",
  draftRevisionConflict: "AI_AGENT_DRAFT_REVISION_CONFLICT",
  notFound: "AI_AGENT_NOT_FOUND",
  referenceUnavailable: "AI_AGENT_REFERENCE_UNAVAILABLE",
  revisionConflict: "AI_AGENT_REVISION_CONFLICT",
  versionConflict: "AI_AGENT_VERSION_CONFLICT",
  versionInvalid: "AI_AGENT_VERSION_INVALID",
} as const;

export const AgentCatalogErrorCodeSchema = z.enum([
  AGENT_CATALOG_ERROR_CODES.archived,
  AGENT_CATALOG_ERROR_CODES.definitionInvalid,
  AGENT_CATALOG_ERROR_CODES.draftRevisionConflict,
  AGENT_CATALOG_ERROR_CODES.notFound,
  AGENT_CATALOG_ERROR_CODES.referenceUnavailable,
  AGENT_CATALOG_ERROR_CODES.revisionConflict,
  AGENT_CATALOG_ERROR_CODES.versionConflict,
  AGENT_CATALOG_ERROR_CODES.versionInvalid,
]);

export const AgentCatalogBadRequestErrorCodeSchema = z.enum([
  AGENT_CATALOG_ERROR_CODES.definitionInvalid,
  AGENT_CATALOG_ERROR_CODES.versionInvalid,
]);
export const AgentCatalogNotFoundErrorCodeSchema = z.literal(
  AGENT_CATALOG_ERROR_CODES.notFound,
);
export const AgentCatalogConflictErrorCodeSchema = z.enum([
  AGENT_CATALOG_ERROR_CODES.archived,
  AGENT_CATALOG_ERROR_CODES.draftRevisionConflict,
  AGENT_CATALOG_ERROR_CODES.referenceUnavailable,
  AGENT_CATALOG_ERROR_CODES.revisionConflict,
  AGENT_CATALOG_ERROR_CODES.versionConflict,
]);

function agentCatalogErrorSchema<
  TStatus extends 400 | 404 | 409,
  TCode extends z.ZodType<string>,
>(statusCode: TStatus, code: TCode) {
  return z.strictObject({
    code,
    message: z.string().trim().min(1).max(2_000),
    statusCode: z.literal(statusCode),
  });
}

export const AgentCatalogBadRequestErrorSchema = agentCatalogErrorSchema(
  400,
  AgentCatalogBadRequestErrorCodeSchema,
);
export const AgentCatalogNotFoundErrorSchema = agentCatalogErrorSchema(
  404,
  AgentCatalogNotFoundErrorCodeSchema,
);
export const AgentCatalogConflictErrorSchema = agentCatalogErrorSchema(
  409,
  AgentCatalogConflictErrorCodeSchema,
);
export const AgentCatalogErrorSchema = z.discriminatedUnion("statusCode", [
  AgentCatalogBadRequestErrorSchema,
  AgentCatalogNotFoundErrorSchema,
  AgentCatalogConflictErrorSchema,
]);

function validateAgentDefinition(
  definition: {
    graph: AgentGraph;
    modelReferences: ModelReference[];
    toolReferences: ToolReference[];
  },
  context: z.RefinementCtx,
) {
  const declaredModels = uniqueKeys(
    definition.modelReferences,
    modelReferenceKey,
    "Model references must be unique",
    "modelReferences",
    context,
  );
  const declaredTools = uniqueKeys(
    definition.toolReferences,
    toolReferenceKey,
    "Tool references must be unique",
    "toolReferences",
    context,
  );
  const usedModels = new Set<string>();
  const usedTools = new Set<string>();

  for (const node of definition.graph.nodes) {
    if (node.type === "tool") {
      usedTools.add(toolReferenceKey(node.config.tool));
      continue;
    }
    if (node.type !== "model") continue;

    const binding = node.config.model;
    if (binding.mode === "pinned") {
      usedModels.add(modelReferenceKey(binding.model));
    } else if (binding.mode === "requestOverride") {
      for (const model of binding.allowedModels) {
        usedModels.add(modelReferenceKey(model));
      }
      if (binding.fallback.mode === "pinned") {
        usedModels.add(modelReferenceKey(binding.fallback.model));
      }
    }
  }

  compareReferenceSets(
    declaredModels,
    usedModels,
    "Declared Model references must exactly match the graph",
    "modelReferences",
    context,
  );
  compareReferenceSets(
    declaredTools,
    usedTools,
    "Declared Tool references must exactly match the graph",
    "toolReferences",
    context,
  );
}

function uniqueKeys<T>(
  values: T[],
  keyOf: (value: T) => string,
  message: string,
  path: string,
  context: z.RefinementCtx,
) {
  const keys = new Set<string>();
  for (const [index, value] of values.entries()) {
    const key = keyOf(value);
    if (keys.has(key)) {
      context.addIssue({ code: "custom", message, path: [path, index] });
    }
    keys.add(key);
  }
  return keys;
}

function compareReferenceSets(
  declared: Set<string>,
  used: Set<string>,
  message: string,
  path: string,
  context: z.RefinementCtx,
) {
  if (
    declared.size !== used.size ||
    [...declared].some((key) => !used.has(key))
  ) {
    context.addIssue({ code: "custom", message, path: [path] });
  }
}

function modelReferenceKey(model: ModelReference) {
  return [
    model.providerScope,
    model.deploymentId,
    model.modelId,
    model.capability,
  ].join(":");
}

function toolReferenceKey(tool: ToolReference) {
  return `${tool.toolDefinitionId}:${tool.version}`;
}

export type AgentStatus = z.infer<typeof AgentStatusSchema>;
export type AgentDefinition = z.infer<typeof AgentDefinitionSchema>;
export type Agent = z.infer<typeof AgentSchema>;
export type AgentDraft = z.infer<typeof AgentDraftSchema>;
export type AgentVersionSummary = z.infer<typeof AgentVersionSummarySchema>;
export type AgentVersion = z.infer<typeof AgentVersionSchema>;
export type CreateAgentRequest = z.infer<typeof CreateAgentRequestSchema>;
export type UpdateAgentRequest = z.infer<typeof UpdateAgentRequestSchema>;
export type ReplaceAgentDraftRequest = z.infer<
  typeof ReplaceAgentDraftRequestSchema
>;
export type UpdateAgentDraftRequest = ReplaceAgentDraftRequest;
export type PublishAgentDraftRequest = z.infer<
  typeof PublishAgentDraftRequestSchema
>;
export type AgentCatalogErrorCode = z.infer<
  typeof AgentCatalogErrorCodeSchema
>;
export type AgentCatalogError = z.infer<typeof AgentCatalogErrorSchema>;
