import { z } from "zod";
import { IsoDateTimeSchema, UuidSchema } from "../models.js";
import {
  AiObjectJsonSchema,
  JsonPointerSchema,
  RuntimeIdentifierSchema,
  RuntimeRetryPolicySchema,
  SemanticVersionSchema,
} from "./common.js";
import {
  ToolDefinitionSchema,
  ToolDriverTypeSchema,
  ToolIdempotencySchema,
  ToolSideEffectSchema,
} from "./tool-definition.js";
import {
  AiApiVersionSchema,
  ToolDefinitionSchemaVersionSchema,
} from "./versions.js";

export const TOOL_CONNECTION_SECRET_MASK = "••••••••";

export const ToolCatalogStatusSchema = z.enum(["disabled", "enabled"]);
export const ToolVersionStatusSchema = z.enum([
  "draft",
  "published",
  "disabled",
]);
export const ExternalToolDriverTypeSchema = z.enum([
  "http",
  "mcpStreamableHttp",
]);
export const ToolConnectionAuthTypeSchema = z.enum([
  "none",
  "bearer",
  "header",
]);
export const ToolNetworkSchemeSchema = z.enum(["http", "https"]);
export const ToolHttpMethodSchema = z.enum([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
]);

export const TOOL_GATEWAY_BAD_REQUEST_ERROR_CODES = Object.freeze([
  "AI_TOOL_CONNECTION_AUTH_DISABLED",
  "AI_TOOL_CONNECTION_INVALID",
  "AI_TOOL_CONNECTION_SECRET_INVALID",
  "AI_TOOL_INVALID_REQUEST",
  "TOOL_ENDPOINT_COMPONENT_FORBIDDEN",
  "TOOL_ENDPOINT_HOST_FORBIDDEN",
  "TOOL_ENDPOINT_INVALID",
  "TOOL_ENDPOINT_NOT_APPROVED",
  "TOOL_ENDPOINT_SCHEME_FORBIDDEN",
  "TOOL_HEADER_FORBIDDEN",
  "TOOL_HEADER_INVALID",
  "TOOL_NETWORK_ADDRESS_FORBIDDEN",
  "TOOL_NETWORK_ADDRESS_INVALID",
] as const);
export const ToolGatewayBadRequestErrorCodeSchema = z.enum(
  TOOL_GATEWAY_BAD_REQUEST_ERROR_CODES,
);
export const ToolGatewayUnauthorizedErrorCodeSchema = z.literal(
  "AI_TOOL_AUTHENTICATION_REQUIRED",
);
export const ToolGatewayForbiddenErrorCodeSchema = z.literal(
  "AI_TOOL_AUTHORIZATION_DENIED",
);
export const ToolGatewayNotFoundErrorCodeSchema = z.literal(
  "AI_TOOL_NOT_FOUND",
);
export const ToolGatewayConflictErrorCodeSchema = z.enum([
  "AI_TOOL_CONFLICT",
  "AI_TOOL_UNAVAILABLE",
]);
export const ToolGatewayTooManyRequestsErrorCodeSchema = z.literal(
  "AI_TOOL_RATE_LIMITED",
);
export const ToolGatewayInternalErrorCodeSchema = z.literal(
  "AI_TOOL_INTERNAL_ERROR",
);

function toolGatewayErrorSchema<
  TStatus extends 400 | 401 | 403 | 404 | 409 | 429 | 500,
  TCode extends z.ZodType<string>,
>(statusCode: TStatus, code: TCode) {
  return z.strictObject({
    code,
    message: z.string().trim().min(1).max(2_000),
    statusCode: z.literal(statusCode),
  });
}

export const ToolGatewayBadRequestErrorSchema = toolGatewayErrorSchema(
  400,
  ToolGatewayBadRequestErrorCodeSchema,
);
export const ToolGatewayUnauthorizedErrorSchema = toolGatewayErrorSchema(
  401,
  ToolGatewayUnauthorizedErrorCodeSchema,
);
export const ToolGatewayForbiddenErrorSchema = toolGatewayErrorSchema(
  403,
  ToolGatewayForbiddenErrorCodeSchema,
);
export const ToolGatewayNotFoundErrorSchema = toolGatewayErrorSchema(
  404,
  ToolGatewayNotFoundErrorCodeSchema,
);
export const ToolGatewayConflictErrorSchema = toolGatewayErrorSchema(
  409,
  ToolGatewayConflictErrorCodeSchema,
);
export const ToolGatewayTooManyRequestsErrorSchema = toolGatewayErrorSchema(
  429,
  ToolGatewayTooManyRequestsErrorCodeSchema,
);
export const ToolGatewayInternalErrorSchema = toolGatewayErrorSchema(
  500,
  ToolGatewayInternalErrorCodeSchema,
);
export const ToolGatewayErrorSchema = z.discriminatedUnion("statusCode", [
  ToolGatewayBadRequestErrorSchema,
  ToolGatewayUnauthorizedErrorSchema,
  ToolGatewayForbiddenErrorSchema,
  ToolGatewayNotFoundErrorSchema,
  ToolGatewayConflictErrorSchema,
  ToolGatewayTooManyRequestsErrorSchema,
  ToolGatewayInternalErrorSchema,
]);

const RevisionSchema = z.number().int().positive();
const DisplayNameSchema = z.string().trim().min(1).max(120);
const DescriptionSchema = z.string().trim().min(1).max(2_000);
const Sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const PortSchema = z.number().int().min(1).max(65_535);

const ExactDnsHostSchema = z.string().trim().min(1).max(253)
  .regex(
    /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/,
    "Expected a lowercase exact DNS host name",
  )
  .refine((value) => !value.includes("*"), "Wildcard hosts are not allowed")
  .refine(
    (value) => !/^\d+(?:\.\d+){3}$/.test(value),
    "IP literal hosts are not allowed",
  )
  .refine(
    (value) => {
      try {
        return new URL(`https://${value}`).hostname === value;
      } catch {
        return false;
      }
    },
    "Legacy or ambiguous IP host forms are not allowed",
  );

const FixedPathSchema = z.string().trim().min(1).max(500)
  .startsWith("/")
  .superRefine((value, context) => {
    if (
      value.includes("//") ||
      value.includes("?") ||
      value.includes("#") ||
      value.includes("\\") ||
      value.includes(";") ||
      /%(?:25|2e|2f|3b|5c)/i.test(value) ||
      /[\u0000-\u001f\u007f]/.test(value)
    ) {
      context.addIssue({
        code: "custom",
        message: "Fixed paths must use canonical segments without query, fragment, matrix parameters, encoded separators, backslash, or control characters",
      });
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(value);
    } catch {
      context.addIssue({ code: "custom", message: "Fixed path encoding is invalid" });
      return;
    }
    if (decoded.split("/").some((segment) => segment === "." || segment === "..")) {
      context.addIssue({ code: "custom", message: "Fixed paths cannot contain dot segments" });
    }
  });

const ToolConnectionBaseUrlSchema = z.url().max(500).superRefine(
  (value, context) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      context.addIssue({ code: "custom", message: "Connection base URL is invalid" });
      return;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      context.addIssue({
        code: "custom",
        message: "Connection base URL must use HTTP or HTTPS",
      });
    }
    if (url.username || url.password) {
      context.addIssue({
        code: "custom",
        message: "Connection base URL cannot contain credentials",
      });
    }
    if (url.search || url.hash) {
      context.addIssue({
        code: "custom",
        message: "Connection base URL cannot contain query or fragment data",
      });
    }
  },
);

const TOOL_GATEWAY_CONTROLLED_HEADER_NAMES = new Set([
  "authorization",
  "cf-connecting-ip",
  "connection",
  "constructor",
  "content-length",
  "cookie",
  "cookie2",
  "expect",
  "forwarded",
  "host",
  "keep-alive",
  "origin",
  "proxy-authenticate",
  "proxy-authorization",
  "prototype",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "true-client-ip",
  "upgrade",
  "via",
  "x-client-ip",
  "x-http-method-override",
  "x-method-override",
  "x-real-ip",
  "__proto__",
]);

const TOOL_GATEWAY_CONTROLLED_HEADER_PREFIXES = Object.freeze([
  "proxy-",
  "sec-",
  "x-accel-",
  "x-envoy-",
  "x-forwarded-",
  "x-hermes-",
  "x-original-",
  "x-rewrite-",
]);

export function isToolGatewayControlledHeaderName(value: string) {
  const normalized = value.trim().toLowerCase();
  return (
    TOOL_GATEWAY_CONTROLLED_HEADER_NAMES.has(normalized) ||
    TOOL_GATEWAY_CONTROLLED_HEADER_PREFIXES.some((prefix) =>
      normalized.startsWith(prefix)
    )
  );
}

export const ToolConnectionAuthHeaderNameSchema = z.string().trim().min(1).max(120)
  .regex(/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/, "Expected an HTTP header name")
  .refine(
    (value) => !isToolGatewayControlledHeaderName(value),
    "Authentication header is reserved",
  );

export const InternalToolDriverConfigSchema = z.strictObject({
  handlerKey: RuntimeIdentifierSchema,
});

export const HttpToolDriverConfigSchema = z.strictObject({
  method: ToolHttpMethodSchema,
  path: FixedPathSchema,
});

export const McpStreamableHttpToolDriverConfigSchema = z.strictObject({
  schemaDigest: Sha256DigestSchema,
  toolName: z.string().trim().min(1).max(128),
});

export const ToolVersionDriverConfigSchema = z.union([
  InternalToolDriverConfigSchema,
  HttpToolDriverConfigSchema,
  McpStreamableHttpToolDriverConfigSchema,
]);

const ToolVersionDefinitionFields = {
  allowsArtifact: z.boolean(),
  driverConfig: ToolVersionDriverConfigSchema,
  driverType: ToolDriverTypeSchema,
  idempotency: ToolIdempotencySchema,
  inputSchema: AiObjectJsonSchema,
  maxResponseBytes: z.number().int().min(1_024).max(10 * 1024 * 1024),
  networkPolicyIds: z.array(UuidSchema).max(20),
  outputRedactionPaths: z.array(JsonPointerSchema).max(100),
  outputSchema: AiObjectJsonSchema,
  requiredPermissions: z.array(RuntimeIdentifierSchema).max(100),
  retry: RuntimeRetryPolicySchema,
  schemaVersion: ToolDefinitionSchemaVersionSchema,
  sideEffect: ToolSideEffectSchema,
  timeoutMs: z.number().int().min(100).max(120_000),
  version: SemanticVersionSchema,
} as const;

const ToolVersionDefinitionInputSchema = z.strictObject(
  ToolVersionDefinitionFields,
).superRefine(validateToolVersionDefinition);

export const PlatformToolDefinitionSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  createdAt: IsoDateTimeSchema,
  description: DescriptionSchema,
  displayName: DisplayNameSchema,
  id: UuidSchema,
  name: RuntimeIdentifierSchema,
  revision: RevisionSchema,
  status: ToolCatalogStatusSchema,
  updatedAt: IsoDateTimeSchema,
});

export const PlatformToolVersionSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  contentDigest: Sha256DigestSchema,
  createdAt: IsoDateTimeSchema,
  revision: RevisionSchema,
  status: ToolVersionStatusSchema,
  toolDefinitionId: UuidSchema,
  updatedAt: IsoDateTimeSchema,
  ...ToolVersionDefinitionFields,
}).superRefine(validateToolVersionDefinition);

export const PlatformToolNetworkPolicySchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  createdAt: IsoDateTimeSchema,
  host: ExactDnsHostSchema,
  id: UuidSchema,
  name: DisplayNameSchema,
  pathPrefix: FixedPathSchema,
  port: PortSchema,
  revision: RevisionSchema,
  scheme: ToolNetworkSchemeSchema,
  status: ToolCatalogStatusSchema,
  updatedAt: IsoDateTimeSchema,
});

const MissingToolConnectionSecretMetadataSchema = z.strictObject({
  configured: z.literal(false),
  id: z.null(),
  mask: z.null(),
  revision: z.literal(0),
  updatedAt: z.null(),
});

const ConfiguredToolConnectionSecretMetadataSchema = z.strictObject({
  configured: z.literal(true),
  id: UuidSchema,
  mask: z.literal(TOOL_CONNECTION_SECRET_MASK),
  revision: RevisionSchema,
  updatedAt: IsoDateTimeSchema,
});

/** Public metadata never contains an encrypted envelope or credential value. */
export const ToolConnectionSecretMetadataSchema = z.discriminatedUnion(
  "configured",
  [
    MissingToolConnectionSecretMetadataSchema,
    ConfiguredToolConnectionSecretMetadataSchema,
  ],
);

export const WorkspaceToolConnectionSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  authHeaderName: ToolConnectionAuthHeaderNameSchema.nullable(),
  authType: ToolConnectionAuthTypeSchema,
  baseUrl: ToolConnectionBaseUrlSchema,
  createdAt: IsoDateTimeSchema,
  driverType: ExternalToolDriverTypeSchema,
  id: UuidSchema,
  name: DisplayNameSchema,
  networkPolicyId: UuidSchema,
  revision: RevisionSchema,
  secret: ToolConnectionSecretMetadataSchema,
  status: ToolCatalogStatusSchema,
  updatedAt: IsoDateTimeSchema,
  workspaceId: UuidSchema,
}).superRefine((connection, context) => {
  validateConnectionAuthentication(connection, context);
  if (connection.authType === "none" && connection.secret.configured) {
    context.addIssue({
      code: "custom",
      message: "Connections without authentication cannot retain credentials",
      path: ["secret"],
    });
  }
  if (
    connection.status === "enabled" &&
    connection.authType !== "none" &&
    !connection.secret.configured
  ) {
    context.addIssue({
      code: "custom",
      message: "Enabled authenticated connections require a credential",
      path: ["secret"],
    });
  }
});

export const WorkspaceToolGrantSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  configured: z.boolean(),
  connectionId: UuidSchema.nullable(),
  createdAt: IsoDateTimeSchema,
  enabled: z.boolean(),
  expiresAt: IsoDateTimeSchema.nullable(),
  id: UuidSchema,
  revision: RevisionSchema,
  toolDefinitionId: UuidSchema,
  toolVersion: SemanticVersionSchema,
  updatedAt: IsoDateTimeSchema,
  workspaceId: UuidSchema,
});

export const CreatePlatformToolDefinitionRequestSchema = z.strictObject({
  description: DescriptionSchema,
  displayName: DisplayNameSchema,
  name: RuntimeIdentifierSchema,
  status: ToolCatalogStatusSchema.default("disabled"),
});

export const UpdatePlatformToolDefinitionRequestSchema = z.strictObject({
  description: DescriptionSchema.optional(),
  displayName: DisplayNameSchema.optional(),
  expectedRevision: RevisionSchema,
  name: RuntimeIdentifierSchema.optional(),
  status: ToolCatalogStatusSchema.optional(),
}).refine(hasUpdateField, "At least one Tool Definition field is required");

export const CreatePlatformToolVersionRequestSchema = z.strictObject({
  ...ToolVersionDefinitionFields,
  status: ToolVersionStatusSchema.default("draft"),
}).superRefine(validateToolVersionDefinition);

/** Published content is immutable; only availability may change in place. */
export const UpdatePlatformToolVersionStatusRequestSchema = z.strictObject({
  expectedRevision: RevisionSchema,
  status: ToolVersionStatusSchema,
});

export const CreatePlatformToolNetworkPolicyRequestSchema = z.strictObject({
  host: ExactDnsHostSchema,
  name: DisplayNameSchema,
  pathPrefix: FixedPathSchema.default("/"),
  port: PortSchema,
  scheme: ToolNetworkSchemeSchema,
  status: ToolCatalogStatusSchema.default("disabled"),
});

export const UpdatePlatformToolNetworkPolicyRequestSchema = z.strictObject({
  expectedRevision: RevisionSchema,
  host: ExactDnsHostSchema.optional(),
  name: DisplayNameSchema.optional(),
  pathPrefix: FixedPathSchema.optional(),
  port: PortSchema.optional(),
  scheme: ToolNetworkSchemeSchema.optional(),
  status: ToolCatalogStatusSchema.optional(),
}).refine(hasUpdateField, "At least one Network Policy field is required");

export const ToolConnectionSecretWriteRequestSchema = z.strictObject({
  value: z.string().min(1).max(8_192)
    .regex(
      /^[\x20-\x7e]+$/,
      "Connection credentials must be an ASCII HTTP field value",
    )
    .refine(
      (value) => Boolean(value.trim()),
      "Connection credentials cannot be blank",
    ),
});

export const ToolConnectionSecretMutationResponseSchema = z.strictObject({
  secret: ToolConnectionSecretMetadataSchema,
});

export const CreateWorkspaceToolConnectionRequestSchema = z.strictObject({
  authHeaderName: ToolConnectionAuthHeaderNameSchema.nullable().optional(),
  authType: ToolConnectionAuthTypeSchema.default("none"),
  baseUrl: ToolConnectionBaseUrlSchema,
  driverType: ExternalToolDriverTypeSchema,
  name: DisplayNameSchema,
  networkPolicyId: UuidSchema,
  secret: ToolConnectionSecretWriteRequestSchema.optional(),
  status: ToolCatalogStatusSchema.default("disabled"),
}).superRefine((connection, context) => {
  validateConnectionAuthentication(connection, context);
  if (connection.authType === "none" && connection.secret !== undefined) {
    context.addIssue({
      code: "custom",
      message: "Connections without authentication cannot include a credential",
      path: ["secret"],
    });
  }
  if (
    connection.status === "enabled" &&
    connection.authType !== "none" &&
    connection.secret === undefined
  ) {
    context.addIssue({
      code: "custom",
      message: "Authenticated connections require a credential before enablement",
      path: ["secret"],
    });
  }
});

export const UpdateWorkspaceToolConnectionRequestSchema = z.strictObject({
  authHeaderName: ToolConnectionAuthHeaderNameSchema.nullable().optional(),
  authType: ToolConnectionAuthTypeSchema.optional(),
  baseUrl: ToolConnectionBaseUrlSchema.optional(),
  expectedRevision: RevisionSchema,
  name: DisplayNameSchema.optional(),
  networkPolicyId: UuidSchema.optional(),
  status: ToolCatalogStatusSchema.optional(),
}).superRefine((connection, context) => {
  if (!hasUpdateField(connection)) {
    context.addIssue({
      code: "custom",
      message: "At least one Connection field is required",
    });
  }
  if (connection.authType !== undefined) {
    validateConnectionAuthentication({
      authHeaderName: connection.authHeaderName ?? null,
      authType: connection.authType,
    }, context);
  }
});

export const CreateWorkspaceToolGrantRequestSchema = z.strictObject({
  enabled: z.boolean().default(false),
  expiresAt: IsoDateTimeSchema.nullable().optional(),
  toolDefinitionId: UuidSchema,
  toolVersion: SemanticVersionSchema,
});

export const UpdateWorkspaceToolGrantRequestSchema = z.strictObject({
  enabled: z.boolean().optional(),
  expectedRevision: RevisionSchema,
  expiresAt: IsoDateTimeSchema.nullable().optional(),
}).refine(hasUpdateField, "At least one Tool Grant field is required");

export const BindWorkspaceToolGrantConnectionRequestSchema = z.strictObject({
  connectionId: UuidSchema.nullable(),
  expectedRevision: RevisionSchema,
});

const NetworkPolicyRevisionSchema = z.strictObject({
  id: UuidSchema,
  revision: RevisionSchema,
});

/**
 * Safe runtime-facing result. Endpoint URLs, credential IDs, ciphertext and
 * plaintext remain private to the Worker credential/network brokers.
 */
export const ResolvedToolExecutionDescriptorSchema = z.strictObject({
  apiVersion: AiApiVersionSchema,
  connectionRevision: RevisionSchema.nullable(),
  driverConfig: ToolVersionDriverConfigSchema,
  grantId: UuidSchema,
  grantRevision: RevisionSchema,
  networkPolicies: z.array(NetworkPolicyRevisionSchema).max(20),
  tool: ToolDefinitionSchema,
  toolDefinitionRevision: RevisionSchema,
  toolVersionId: UuidSchema,
  toolVersionRevision: RevisionSchema,
}).superRefine((descriptor, context) => {
  if (!driverConfigMatches(descriptor.tool.driverType, descriptor.driverConfig)) {
    context.addIssue({
      code: "custom",
      message: "Resolved driver configuration does not match driverType",
      path: ["driverConfig"],
    });
  }
  const configuredPolicyIds = descriptor.tool.networkPolicyIds;
  const resolvedPolicyIds = descriptor.networkPolicies.map(({ id }) => id);
  if (!sameUniqueValues(configuredPolicyIds, resolvedPolicyIds)) {
    context.addIssue({
      code: "custom",
      message: "Resolved network policy revisions must match the Tool Definition",
      path: ["networkPolicies"],
    });
  }
  if (descriptor.tool.driverType === "internal") {
    if (descriptor.connectionRevision !== null) {
      context.addIssue({
        code: "custom",
        message: "Internal tools cannot include a connection revision",
        path: ["connectionRevision"],
      });
    }
  } else if (descriptor.connectionRevision === null) {
    context.addIssue({
      code: "custom",
      message: "External tools require a resolved connection revision",
      path: ["connectionRevision"],
    });
  } else if (descriptor.networkPolicies.length === 0) {
    context.addIssue({
      code: "custom",
      message: "External tools require at least one resolved network policy",
      path: ["networkPolicies"],
    });
  }
});

function validateToolVersionDefinition(
  tool: z.infer<typeof ToolVersionDefinitionInputSchema>,
  context: z.RefinementCtx,
) {
  const configMatches = driverConfigMatches(tool.driverType, tool.driverConfig);
  if (!configMatches) {
    context.addIssue({
      code: "custom",
      message: "Driver configuration does not match driverType",
      path: ["driverConfig"],
    });
  }

  if (tool.driverType === "internal" && tool.networkPolicyIds.length > 0) {
    context.addIssue({
      code: "custom",
      message: "Internal tools cannot reference outbound network policies",
      path: ["networkPolicyIds"],
    });
  }
  if (tool.driverType !== "internal" && tool.networkPolicyIds.length === 0) {
    context.addIssue({
      code: "custom",
      message: "External tools require at least one outbound network policy",
      path: ["networkPolicyIds"],
    });
  }
  if (tool.sideEffect === "none" && tool.idempotency !== "notRequired") {
    context.addIssue({
      code: "custom",
      message: "Side-effect-free tools do not require idempotency",
      path: ["idempotency"],
    });
  }
  if (tool.sideEffect !== "none" && tool.idempotency === "notRequired") {
    context.addIssue({
      code: "custom",
      message: "Tools with side effects must declare an idempotency policy",
      path: ["idempotency"],
    });
  }
  if (tool.retry.maxAttempts > 1 && tool.idempotency === "unsupported") {
    context.addIssue({
      code: "custom",
      message: "Non-idempotent tools cannot be retried automatically",
      path: ["retry", "maxAttempts"],
    });
  }
  for (const field of [
    "networkPolicyIds",
    "outputRedactionPaths",
    "requiredPermissions",
  ] as const) {
    if (new Set(tool[field]).size !== tool[field].length) {
      context.addIssue({
        code: "custom",
        message: `${field} values must be unique`,
        path: [field],
      });
    }
  }
}

function driverConfigMatches(
  driverType: z.infer<typeof ToolDriverTypeSchema>,
  driverConfig: unknown,
) {
  return (
    (driverType === "internal" &&
      InternalToolDriverConfigSchema.safeParse(driverConfig).success) ||
    (driverType === "http" &&
      HttpToolDriverConfigSchema.safeParse(driverConfig).success) ||
    (driverType === "mcpStreamableHttp" &&
      McpStreamableHttpToolDriverConfigSchema.safeParse(driverConfig).success)
  );
}

function validateConnectionAuthentication(
  connection: {
    authHeaderName?: string | null;
    authType: z.infer<typeof ToolConnectionAuthTypeSchema>;
  },
  context: z.RefinementCtx,
) {
  if (connection.authType === "header" && !connection.authHeaderName) {
    context.addIssue({
      code: "custom",
      message: "Header authentication requires authHeaderName",
      path: ["authHeaderName"],
    });
  }
  if (connection.authType !== "header" && connection.authHeaderName) {
    context.addIssue({
      code: "custom",
      message: "authHeaderName is only valid for header authentication",
      path: ["authHeaderName"],
    });
  }
}

function hasUpdateField(value: Record<string, unknown>) {
  return Object.entries(value).some(
    ([field, item]) => field !== "expectedRevision" && item !== undefined,
  );
}

function sameUniqueValues(left: readonly string[], right: readonly string[]) {
  return (
    new Set(left).size === left.length &&
    new Set(right).size === right.length &&
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

export type ToolCatalogStatus = z.infer<typeof ToolCatalogStatusSchema>;
export type ToolVersionStatus = z.infer<typeof ToolVersionStatusSchema>;
export type ExternalToolDriverType = z.infer<
  typeof ExternalToolDriverTypeSchema
>;
export type ToolConnectionAuthType = z.infer<
  typeof ToolConnectionAuthTypeSchema
>;
export type ToolNetworkScheme = z.infer<typeof ToolNetworkSchemeSchema>;
export type ToolHttpMethod = z.infer<typeof ToolHttpMethodSchema>;
export type ToolGatewayError = z.infer<typeof ToolGatewayErrorSchema>;
export type ToolGatewayErrorCode = ToolGatewayError["code"];
export type InternalToolDriverConfig = z.infer<
  typeof InternalToolDriverConfigSchema
>;
export type HttpToolDriverConfig = z.infer<typeof HttpToolDriverConfigSchema>;
export type McpStreamableHttpToolDriverConfig = z.infer<
  typeof McpStreamableHttpToolDriverConfigSchema
>;
export type ToolVersionDriverConfig = z.infer<
  typeof ToolVersionDriverConfigSchema
>;
export type PlatformToolDefinition = z.infer<
  typeof PlatformToolDefinitionSchema
>;
export type PlatformToolVersion = z.infer<typeof PlatformToolVersionSchema>;
export type PlatformToolNetworkPolicy = z.infer<
  typeof PlatformToolNetworkPolicySchema
>;
export type ToolConnectionSecretMetadata = z.infer<
  typeof ToolConnectionSecretMetadataSchema
>;
export type ToolConnectionSecretMutationResponse = z.infer<
  typeof ToolConnectionSecretMutationResponseSchema
>;
export type WorkspaceToolConnection = z.infer<
  typeof WorkspaceToolConnectionSchema
>;
export type WorkspaceToolGrant = z.infer<typeof WorkspaceToolGrantSchema>;
export type CreatePlatformToolDefinitionRequest = z.infer<
  typeof CreatePlatformToolDefinitionRequestSchema
>;
export type UpdatePlatformToolDefinitionRequest = z.infer<
  typeof UpdatePlatformToolDefinitionRequestSchema
>;
export type CreatePlatformToolVersionRequest = z.infer<
  typeof CreatePlatformToolVersionRequestSchema
>;
export type UpdatePlatformToolVersionStatusRequest = z.infer<
  typeof UpdatePlatformToolVersionStatusRequestSchema
>;
export type CreatePlatformToolNetworkPolicyRequest = z.infer<
  typeof CreatePlatformToolNetworkPolicyRequestSchema
>;
export type UpdatePlatformToolNetworkPolicyRequest = z.infer<
  typeof UpdatePlatformToolNetworkPolicyRequestSchema
>;
export type ToolConnectionSecretWriteRequest = z.infer<
  typeof ToolConnectionSecretWriteRequestSchema
>;
export type CreateWorkspaceToolConnectionRequest = z.infer<
  typeof CreateWorkspaceToolConnectionRequestSchema
>;
export type UpdateWorkspaceToolConnectionRequest = z.infer<
  typeof UpdateWorkspaceToolConnectionRequestSchema
>;
export type CreateWorkspaceToolGrantRequest = z.infer<
  typeof CreateWorkspaceToolGrantRequestSchema
>;
export type UpdateWorkspaceToolGrantRequest = z.infer<
  typeof UpdateWorkspaceToolGrantRequestSchema
>;
export type BindWorkspaceToolGrantConnectionRequest = z.infer<
  typeof BindWorkspaceToolGrantConnectionRequestSchema
>;
export type ResolvedToolExecutionDescriptor = z.infer<
  typeof ResolvedToolExecutionDescriptorSchema
>;
