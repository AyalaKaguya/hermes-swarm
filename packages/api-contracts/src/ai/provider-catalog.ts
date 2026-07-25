import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "../models.js";
import { ModelCapabilitySchema } from "./model-reference.js";
import { AiApiVersionSchema } from "./versions.js";

export const MODEL_PROVIDER_DRIVER_OPENAI_COMPATIBLE = "openai-compatible";
export const PROVIDER_SECRET_MASK = "••••••••";

export const ModelProviderDriverSchema = z.enum([
  MODEL_PROVIDER_DRIVER_OPENAI_COMPATIBLE,
]);

export const ModelProviderStatusSchema = z.enum(["disabled", "enabled"]);

export const ProviderSecretWriteRequestSchema = z.strictObject({
  apiKey: z.string().min(1).max(8_192),
});

const MissingProviderSecretMetadataSchema = z.strictObject({
  configured: z.literal(false),
  id: z.null(),
  mask: z.null(),
  revision: z.literal(0),
  updatedAt: z.null(),
});

const ConfiguredProviderSecretMetadataSchema = z.strictObject({
  configured: z.literal(true),
  id: UuidSchema,
  mask: z.literal(PROVIDER_SECRET_MASK),
  revision: z.number().int().min(1),
  updatedAt: IsoDateTimeSchema,
});

/**
 * The only credential representation allowed in public read responses.
 * Ciphertext envelopes and secret fragments deliberately have no schema field.
 */
export const ProviderSecretMetadataSchema = z.discriminatedUnion("configured", [
  MissingProviderSecretMetadataSchema,
  ConfiguredProviderSecretMetadataSchema,
]);

const ProviderNameSchema = z.string().trim().min(1).max(120);
const ProviderBaseUrlSchema = z.url().max(500);
const ModelDisplayNameSchema = z.string().trim().min(1).max(120);
const ModelIdSchema = z.string().trim().min(1).max(240);

const ModelProviderFields = {
  apiVersion: AiApiVersionSchema,
  baseUrl: ProviderBaseUrlSchema,
  createdAt: IsoDateTimeSchema,
  driver: ModelProviderDriverSchema,
  id: UuidSchema,
  name: ProviderNameSchema,
  revision: z.number().int().min(1),
  secret: ProviderSecretMetadataSchema,
  status: ModelProviderStatusSchema,
  updatedAt: IsoDateTimeSchema,
} as const;

export const PlatformModelProviderSchema = z.strictObject(ModelProviderFields);

export const WorkspaceModelProviderSchema = z.strictObject({
  ...ModelProviderFields,
  workspaceId: UuidSchema,
});

const ModelDeploymentFields = {
  apiVersion: AiApiVersionSchema,
  capability: ModelCapabilitySchema,
  createdAt: IsoDateTimeSchema,
  id: UuidSchema,
  modelId: ModelIdSchema,
  name: ModelDisplayNameSchema,
  providerId: UuidSchema,
  revision: z.number().int().min(1),
  status: ModelProviderStatusSchema,
  updatedAt: IsoDateTimeSchema,
} as const;

export const PlatformModelDeploymentSchema = z.strictObject(
  ModelDeploymentFields,
);

export const WorkspaceModelDeploymentSchema = z.strictObject({
  ...ModelDeploymentFields,
  workspaceId: UuidSchema,
});

export const WorkspaceModelGrantSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  createdAt: IsoDateTimeSchema,
  enabled: z.boolean(),
  expiresAt: IsoDateTimeSchema.nullable(),
  id: UuidSchema,
  platformDeploymentId: UuidSchema,
  revision: z.number().int().min(1),
  updatedAt: IsoDateTimeSchema,
  workspaceId: UuidSchema,
});

export const WorkspaceDefaultModelSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  capability: ModelCapabilitySchema,
  createdAt: IsoDateTimeSchema,
  id: UuidSchema,
  platformDeploymentId: UuidSchema.nullable(),
  updatedAt: IsoDateTimeSchema,
  workspaceDeploymentId: UuidSchema.nullable(),
  workspaceId: UuidSchema,
}).superRefine(validateExactlyOneDeployment);

const CreateModelProviderRequestSchema = z.strictObject({
  baseUrl: ProviderBaseUrlSchema,
  driver: ModelProviderDriverSchema,
  name: ProviderNameSchema,
  secret: ProviderSecretWriteRequestSchema.optional(),
  status: ModelProviderStatusSchema.default("disabled"),
});

export const CreatePlatformModelProviderRequestSchema =
  CreateModelProviderRequestSchema;
export const CreateWorkspaceModelProviderRequestSchema =
  CreateModelProviderRequestSchema;

const UpdateModelProviderRequestSchema = z.strictObject({
  baseUrl: ProviderBaseUrlSchema.optional(),
  name: ProviderNameSchema.optional(),
  status: ModelProviderStatusSchema.optional(),
}).refine(hasDefinedValue, "At least one provider field is required");

export const UpdatePlatformModelProviderRequestSchema =
  UpdateModelProviderRequestSchema;
export const UpdateWorkspaceModelProviderRequestSchema =
  UpdateModelProviderRequestSchema;

export const RotateProviderSecretRequestSchema =
  ProviderSecretWriteRequestSchema;

export const ProviderSecretMutationResponseSchema = z.strictObject({
  secret: ProviderSecretMetadataSchema,
});

const CreateModelDeploymentRequestSchema = z.strictObject({
  capability: ModelCapabilitySchema,
  modelId: ModelIdSchema,
  name: ModelDisplayNameSchema,
  status: ModelProviderStatusSchema.default("disabled"),
});

export const CreatePlatformModelDeploymentRequestSchema =
  CreateModelDeploymentRequestSchema;
export const CreateWorkspaceModelDeploymentRequestSchema =
  CreateModelDeploymentRequestSchema;

const UpdateModelDeploymentRequestSchema = z.strictObject({
  capability: ModelCapabilitySchema.optional(),
  modelId: ModelIdSchema.optional(),
  name: ModelDisplayNameSchema.optional(),
  status: ModelProviderStatusSchema.optional(),
}).refine(hasDefinedValue, "At least one deployment field is required");

export const UpdatePlatformModelDeploymentRequestSchema =
  UpdateModelDeploymentRequestSchema;
export const UpdateWorkspaceModelDeploymentRequestSchema =
  UpdateModelDeploymentRequestSchema;

export const CreateWorkspaceModelGrantRequestSchema = z.strictObject({
  enabled: z.boolean().optional(),
  expiresAt: IsoDateTimeSchema.nullable().optional(),
  platformDeploymentId: UuidSchema,
});

export const UpdateWorkspaceModelGrantRequestSchema = z.strictObject({
  enabled: z.boolean().optional(),
  expiresAt: IsoDateTimeSchema.nullable().optional(),
}).refine(hasDefinedValue, "At least one grant field is required");

export const SetWorkspaceDefaultModelRequestSchema = z.strictObject({
  capability: ModelCapabilitySchema,
  platformDeploymentId: UuidSchema.nullable().optional(),
  workspaceDeploymentId: UuidSchema.nullable().optional(),
}).superRefine(validateExactlyOneDeployment);

function hasDefinedValue(value: Record<string, unknown>) {
  return Object.values(value).some((item) => item !== undefined);
}

function validateExactlyOneDeployment(
  value: {
    platformDeploymentId?: string | null;
    workspaceDeploymentId?: string | null;
  },
  context: z.RefinementCtx,
) {
  const selected = [
    value.platformDeploymentId,
    value.workspaceDeploymentId,
  ].filter((id): id is string => typeof id === "string");
  if (selected.length !== 1) {
    context.addIssue({
      code: "custom",
      message: "Exactly one platform or workspace deployment is required",
      path: ["platformDeploymentId"],
    });
  }
}

export type ModelProviderDriver = z.infer<typeof ModelProviderDriverSchema>;
export type ModelProviderStatus = z.infer<typeof ModelProviderStatusSchema>;
export type ProviderSecretWriteRequest = z.infer<
  typeof ProviderSecretWriteRequestSchema
>;
export type ProviderSecretMetadata = z.infer<
  typeof ProviderSecretMetadataSchema
>;
export type PlatformModelProvider = z.infer<
  typeof PlatformModelProviderSchema
>;
export type WorkspaceModelProvider = z.infer<
  typeof WorkspaceModelProviderSchema
>;
export type PlatformModelDeployment = z.infer<
  typeof PlatformModelDeploymentSchema
>;
export type WorkspaceModelDeployment = z.infer<
  typeof WorkspaceModelDeploymentSchema
>;
export type WorkspaceModelGrant = z.infer<
  typeof WorkspaceModelGrantSchema
>;
export type WorkspaceDefaultModel = z.infer<
  typeof WorkspaceDefaultModelSchema
>;
export type CreatePlatformModelProviderRequest = z.infer<
  typeof CreatePlatformModelProviderRequestSchema
>;
export type CreateWorkspaceModelProviderRequest = z.infer<
  typeof CreateWorkspaceModelProviderRequestSchema
>;
export type UpdatePlatformModelProviderRequest = z.infer<
  typeof UpdatePlatformModelProviderRequestSchema
>;
export type UpdateWorkspaceModelProviderRequest = z.infer<
  typeof UpdateWorkspaceModelProviderRequestSchema
>;
export type CreatePlatformModelDeploymentRequest = z.infer<
  typeof CreatePlatformModelDeploymentRequestSchema
>;
export type CreateWorkspaceModelDeploymentRequest = z.infer<
  typeof CreateWorkspaceModelDeploymentRequestSchema
>;
export type UpdatePlatformModelDeploymentRequest = z.infer<
  typeof UpdatePlatformModelDeploymentRequestSchema
>;
export type UpdateWorkspaceModelDeploymentRequest = z.infer<
  typeof UpdateWorkspaceModelDeploymentRequestSchema
>;
export type CreateWorkspaceModelGrantRequest = z.infer<
  typeof CreateWorkspaceModelGrantRequestSchema
>;
export type UpdateWorkspaceModelGrantRequest = z.infer<
  typeof UpdateWorkspaceModelGrantRequestSchema
>;
export type SetWorkspaceDefaultModelRequest = z.infer<
  typeof SetWorkspaceDefaultModelRequestSchema
>;
