import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AI_API_VERSION,
  TOOL_DEFINITION_SCHEMA_VERSION,
} from "./versions.js";
import {
  BindWorkspaceToolGrantConnectionRequestSchema,
  CreatePlatformToolDefinitionRequestSchema,
  CreatePlatformToolNetworkPolicyRequestSchema,
  CreatePlatformToolVersionRequestSchema,
  CreateWorkspaceToolConnectionRequestSchema,
  CreateWorkspaceToolGrantRequestSchema,
  PlatformToolDefinitionSchema,
  PlatformToolNetworkPolicySchema,
  PlatformToolVersionSchema,
  ResolvedToolExecutionDescriptorSchema,
  TOOL_CONNECTION_SECRET_MASK,
  ToolConnectionSecretMetadataSchema,
  ToolConnectionSecretWriteRequestSchema,
  ToolGatewayErrorSchema,
  UpdatePlatformToolDefinitionRequestSchema,
  UpdatePlatformToolNetworkPolicyRequestSchema,
  UpdatePlatformToolVersionStatusRequestSchema,
  UpdateWorkspaceToolConnectionRequestSchema,
  UpdateWorkspaceToolGrantRequestSchema,
  WorkspaceToolConnectionSchema,
  WorkspaceToolGrantSchema,
} from "./tool-catalog.js";

const ids = {
  connection: "11111111-1111-4111-8111-111111111111",
  grant: "22222222-2222-4222-8222-222222222222",
  networkPolicy: "33333333-3333-4333-8333-333333333333",
  secret: "44444444-4444-4444-8444-444444444444",
  toolDefinition: "55555555-5555-4555-8555-555555555555",
  toolVersion: "66666666-6666-4666-8666-666666666666",
  workspace: "77777777-7777-4777-8777-777777777777",
} as const;

const timestamp = "2026-07-25T10:00:00.000Z";
const digest = "a".repeat(64);

const objectSchema = {
  additionalProperties: false,
  properties: {
    value: { type: "string" },
  },
  required: ["value"],
  type: "object",
} as const;

const httpVersionInput = {
  allowsArtifact: false,
  driverConfig: { method: "POST", path: "/v1/actions" },
  driverType: "http",
  idempotency: "required",
  inputSchema: objectSchema,
  maxResponseBytes: 64 * 1024,
  networkPolicyIds: [ids.networkPolicy],
  outputRedactionPaths: ["/token"],
  outputSchema: objectSchema,
  requiredPermissions: ["ticket.support.read:workspace"],
  retry: { backoffMs: 250, maxAttempts: 2, strategy: "exponential" },
  schemaVersion: TOOL_DEFINITION_SCHEMA_VERSION,
  sideEffect: "reversible",
  timeoutMs: 10_000,
  version: "1.0.0",
} as const;

const secretMetadata = {
  configured: true,
  id: ids.secret,
  mask: TOOL_CONNECTION_SECRET_MASK,
  revision: 2,
  updatedAt: timestamp,
} as const;

describe("Tool Gateway catalog contracts", () => {
  it("keeps stable Tool Definition identity separate from immutable versions", () => {
    const definition = {
      apiVersion: AI_API_VERSION,
      createdAt: timestamp,
      description: "Sends a controlled support action.",
      displayName: "Support action",
      id: ids.toolDefinition,
      name: "support.action",
      revision: 1,
      status: "enabled",
      updatedAt: timestamp,
    } as const;
    assert.equal(PlatformToolDefinitionSchema.safeParse(definition).success, true);
    assert.equal(PlatformToolDefinitionSchema.safeParse({
      ...definition,
      connectionId: ids.connection,
    }).success, false);

    const create = CreatePlatformToolDefinitionRequestSchema.safeParse({
      description: definition.description,
      displayName: definition.displayName,
      name: definition.name,
    });
    assert.equal(create.success, true);
    assert.equal(create.success && create.data.status, "disabled");
    assert.equal(CreatePlatformToolDefinitionRequestSchema.safeParse({
      description: definition.description,
      displayName: definition.displayName,
      name: definition.name,
      workspaceId: ids.workspace,
    }).success, false);

    assert.equal(UpdatePlatformToolDefinitionRequestSchema.safeParse({
      expectedRevision: 1,
      displayName: "Updated support action",
    }).success, true);
    assert.equal(UpdatePlatformToolDefinitionRequestSchema.safeParse({
      displayName: "Missing optimistic revision",
    }).success, false);
    assert.equal(UpdatePlatformToolDefinitionRequestSchema.safeParse({
      expectedRevision: 1,
    }).success, false);
  });

  it("accepts strict versioned driver content and defaults new versions to draft", () => {
    const create = CreatePlatformToolVersionRequestSchema.safeParse(
      httpVersionInput,
    );
    assert.equal(create.success, true);
    assert.equal(create.success && create.data.status, "draft");

    const version = {
      ...httpVersionInput,
      apiVersion: AI_API_VERSION,
      contentDigest: digest,
      createdAt: timestamp,
      revision: 1,
      status: "published",
      toolDefinitionId: ids.toolDefinition,
      updatedAt: timestamp,
    } as const;
    assert.equal(PlatformToolVersionSchema.safeParse(version).success, true);
    assert.equal(PlatformToolVersionSchema.safeParse({
      ...version,
      connectionId: ids.connection,
    }).success, false);

    assert.equal(UpdatePlatformToolVersionStatusRequestSchema.safeParse({
      expectedRevision: 1,
      status: "disabled",
    }).success, true);
    assert.equal(UpdatePlatformToolVersionStatusRequestSchema.safeParse({
      expectedRevision: 1,
      inputSchema: objectSchema,
      status: "published",
    }).success, false);
  });

  it("rejects driver mismatches, unsafe retries, and invalid network references", () => {
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      driverConfig: { handlerKey: "support.action" },
    }).success, false);
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      networkPolicyIds: [],
    }).success, false);
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      networkPolicyIds: [ids.networkPolicy, ids.networkPolicy],
    }).success, false);
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      idempotency: "unsupported",
      retry: { ...httpVersionInput.retry, maxAttempts: 2 },
    }).success, false);
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      idempotency: "notRequired",
      sideEffect: "irreversible",
    }).success, false);
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      version: `1.0.0-${"a".repeat(64)}`,
    }).success, false);
    for (const path of [
      "//attacker.example/action",
      "/%2f%2fattacker.example/action",
      "/%252f%252fattacker.example/action",
      "/safe//action",
      "/safe/..;/action",
    ]) {
      assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
        ...httpVersionInput,
        driverConfig: { method: "POST", path },
      }).success, false, path);
    }
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      outputRedactionPaths: ["/credentials/~2token"],
    }).success, false);
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      outputRedactionPaths: ["/credentials/~0token/~1value"],
    }).success, true);
    assert.equal(CreatePlatformToolVersionRequestSchema.safeParse({
      ...httpVersionInput,
      driverConfig: { handlerKey: "analytics.query" },
      driverType: "internal",
      idempotency: "notRequired",
      networkPolicyIds: [],
      retry: { backoffMs: 0, maxAttempts: 1, strategy: "fixed" },
      sideEffect: "none",
    }).success, true);
  });

  it("models exact outbound Network Policies with optimistic updates", () => {
    const policy = {
      apiVersion: AI_API_VERSION,
      createdAt: timestamp,
      host: "tools.example.com",
      id: ids.networkPolicy,
      name: "Production tools",
      pathPrefix: "/hermes",
      port: 443,
      revision: 1,
      scheme: "https",
      status: "enabled",
      updatedAt: timestamp,
    } as const;
    assert.equal(PlatformToolNetworkPolicySchema.safeParse(policy).success, true);
    const create = CreatePlatformToolNetworkPolicyRequestSchema.safeParse({
      host: policy.host,
      name: policy.name,
      port: policy.port,
      scheme: policy.scheme,
    });
    assert.equal(create.success, true);
    assert.equal(create.success && create.data.pathPrefix, "/");
    assert.equal(create.success && create.data.status, "disabled");

    for (const host of [
      "*.example.com",
      "TOOLS.example.com",
      "localhost",
      "127.0.0.1",
      "127.1",
      "0x7f.1",
    ]) {
      assert.equal(CreatePlatformToolNetworkPolicyRequestSchema.safeParse({
        host,
        name: policy.name,
        port: 443,
        scheme: "https",
      }).success, false);
    }
    assert.equal(UpdatePlatformToolNetworkPolicyRequestSchema.safeParse({
      expectedRevision: 1,
      pathPrefix: "/hermes/v2",
    }).success, true);
    for (const pathPrefix of ["/mcp/..;/admin", "/mcp/%3b/admin"]) {
      assert.equal(CreatePlatformToolNetworkPolicyRequestSchema.safeParse({
        host: policy.host,
        name: policy.name,
        pathPrefix,
        port: 443,
        scheme: "https",
      }).success, false, pathPrefix);
    }
    assert.equal(UpdatePlatformToolNetworkPolicyRequestSchema.safeParse({
      expectedRevision: 1,
    }).success, false);
  });
});

describe("Workspace Tool Connection and Grant contracts", () => {
  it("keeps credentials write-only and returns only masked metadata", () => {
    assert.equal(ToolConnectionSecretWriteRequestSchema.safeParse({
      value: "secret-value",
    }).success, true);
    assert.equal(ToolConnectionSecretWriteRequestSchema.safeParse({
      value: "secret\nvalue",
    }).success, false);
    assert.equal(ToolConnectionSecretWriteRequestSchema.safeParse({
      value: "密钥",
    }).success, false);
    assert.equal(ToolConnectionSecretWriteRequestSchema.safeParse({
      value: "a".repeat(8_193),
    }).success, false);
    assert.equal(ToolConnectionSecretMetadataSchema.safeParse(secretMetadata).success, true);
    assert.equal(ToolConnectionSecretMetadataSchema.safeParse({
      ...secretMetadata,
      envelope: "enc:v1:private",
    }).success, false);
    assert.equal(ToolConnectionSecretMetadataSchema.safeParse({
      configured: false,
      id: null,
      mask: null,
      revision: 0,
      updatedAt: null,
    }).success, true);
  });

  it("validates controlled Workspace Connections without accepting workspace IDs", () => {
    const createConnection = {
      authHeaderName: "X-API-Key",
      authType: "header",
      baseUrl: "https://tools.example.com/hermes",
      driverType: "http",
      name: "Support tools",
      networkPolicyId: ids.networkPolicy,
      secret: { value: "secret-value" },
      status: "enabled",
    } as const;
    assert.equal(CreateWorkspaceToolConnectionRequestSchema.safeParse(
      createConnection,
    ).success, true);
    assert.equal(CreateWorkspaceToolConnectionRequestSchema.safeParse({
      ...createConnection,
      workspaceId: ids.workspace,
    }).success, false);

    for (const baseUrl of [
      "https://user:secret@tools.example.com/hermes",
      "https://tools.example.com/hermes?token=secret",
      "https://tools.example.com/hermes#private",
    ]) {
      assert.equal(CreateWorkspaceToolConnectionRequestSchema.safeParse({
        ...createConnection,
        baseUrl,
      }).success, false);
    }
    for (const authHeaderName of [
      "Authorization",
      "Host",
      "X-Envoy-Original-Path",
      "X-Hermes-Workspace",
      "X-HTTP-Method-Override",
      "X-Original-URL",
    ]) {
      assert.equal(CreateWorkspaceToolConnectionRequestSchema.safeParse({
        ...createConnection,
        authHeaderName,
      }).success, false, authHeaderName);
    }
    assert.equal(CreateWorkspaceToolConnectionRequestSchema.safeParse({
      ...createConnection,
      authHeaderName: null,
    }).success, false);
    assert.equal(CreateWorkspaceToolConnectionRequestSchema.safeParse({
      ...createConnection,
      authHeaderName: null,
      authType: "none",
      secret: undefined,
    }).success, true);

    assert.equal(UpdateWorkspaceToolConnectionRequestSchema.safeParse({
      expectedRevision: 2,
      status: "disabled",
    }).success, true);
    assert.equal(UpdateWorkspaceToolConnectionRequestSchema.safeParse({
      status: "disabled",
    }).success, false);
  });

  it("returns Connection metadata without leaking credentials", () => {
    const connection = {
      apiVersion: AI_API_VERSION,
      authHeaderName: null,
      authType: "bearer",
      baseUrl: "https://tools.example.com/hermes",
      createdAt: timestamp,
      driverType: "mcpStreamableHttp",
      id: ids.connection,
      name: "MCP tools",
      networkPolicyId: ids.networkPolicy,
      revision: 2,
      secret: secretMetadata,
      status: "enabled",
      updatedAt: timestamp,
      workspaceId: ids.workspace,
    } as const;
    assert.equal(WorkspaceToolConnectionSchema.safeParse(connection).success, true);
    for (const privateField of ["credential", "secretEnvelope", "token"] as const) {
      assert.equal(WorkspaceToolConnectionSchema.safeParse({
        ...connection,
        [privateField]: "must-not-leak",
      }).success, false);
    }
    const missingSecret = {
      configured: false,
      id: null,
      mask: null,
      revision: 0,
      updatedAt: null,
    } as const;
    assert.equal(WorkspaceToolConnectionSchema.safeParse({
      ...connection,
      secret: missingSecret,
    }).success, false);
    assert.equal(WorkspaceToolConnectionSchema.safeParse({
      ...connection,
      authType: "none",
      secret: secretMetadata,
    }).success, false);
  });

  it("uses server-selected Workspace scope and explicit connection binding", () => {
    const create = CreateWorkspaceToolGrantRequestSchema.safeParse({
      toolDefinitionId: ids.toolDefinition,
      toolVersion: "1.0.0",
    });
    assert.equal(create.success, true);
    assert.equal(create.success && create.data.enabled, false);
    assert.equal(CreateWorkspaceToolGrantRequestSchema.safeParse({
      toolDefinitionId: ids.toolDefinition,
      toolVersion: "1.0.0",
      workspaceId: ids.workspace,
    }).success, false);

    const grant = {
      apiVersion: AI_API_VERSION,
      configured: true,
      connectionId: ids.connection,
      createdAt: timestamp,
      enabled: true,
      expiresAt: null,
      id: ids.grant,
      revision: 2,
      toolDefinitionId: ids.toolDefinition,
      toolVersion: "1.0.0",
      updatedAt: timestamp,
      workspaceId: ids.workspace,
    } as const;
    assert.equal(WorkspaceToolGrantSchema.safeParse(grant).success, true);
    assert.equal(UpdateWorkspaceToolGrantRequestSchema.safeParse({
      enabled: false,
      expectedRevision: 2,
    }).success, true);
    assert.equal(BindWorkspaceToolGrantConnectionRequestSchema.safeParse({
      connectionId: ids.connection,
      expectedRevision: 2,
    }).success, true);
  });
});

describe("resolved Tool execution descriptor", () => {
  it("contains immutable authorization revisions without endpoint or credential data", () => {
    const tool = {
      allowsArtifact: false,
      connectionId: ids.connection,
      description: "Sends a controlled support action.",
      driverType: "http",
      id: ids.toolDefinition,
      idempotency: "required",
      inputSchema: objectSchema,
      maxResponseBytes: 64 * 1024,
      name: "support.action",
      networkPolicyIds: [ids.networkPolicy],
      outputRedactionPaths: ["/token"],
      outputSchema: objectSchema,
      requiredPermissions: ["ticket.support.read:workspace"],
      retry: { backoffMs: 250, maxAttempts: 2, strategy: "exponential" },
      schemaVersion: TOOL_DEFINITION_SCHEMA_VERSION,
      sideEffect: "reversible",
      timeoutMs: 10_000,
      version: "1.0.0",
    } as const;
    const descriptor = {
      apiVersion: AI_API_VERSION,
      connectionRevision: 2,
      driverConfig: httpVersionInput.driverConfig,
      grantId: ids.grant,
      grantRevision: 2,
      networkPolicies: [{ id: ids.networkPolicy, revision: 3 }],
      tool,
      toolDefinitionRevision: 4,
      toolVersionId: ids.toolVersion,
      toolVersionRevision: 1,
    } as const;
    assert.equal(ResolvedToolExecutionDescriptorSchema.safeParse(descriptor).success, true);
    assert.equal(ResolvedToolExecutionDescriptorSchema.safeParse({
      ...descriptor,
      baseUrl: "https://tools.example.com/hermes",
    }).success, false);
    assert.equal(ResolvedToolExecutionDescriptorSchema.safeParse({
      ...descriptor,
      credential: "must-not-leak",
    }).success, false);
    assert.equal(ResolvedToolExecutionDescriptorSchema.safeParse({
      ...descriptor,
      connectionRevision: null,
    }).success, false);
    assert.equal(ResolvedToolExecutionDescriptorSchema.safeParse({
      ...descriptor,
      driverConfig: { handlerKey: "support.action" },
    }).success, false);
    const { driverConfig: _driverConfig, ...missingDriverConfig } = descriptor;
    assert.equal(
      ResolvedToolExecutionDescriptorSchema.safeParse(missingDriverConfig).success,
      false,
    );
    assert.equal(ResolvedToolExecutionDescriptorSchema.safeParse({
      ...descriptor,
      networkPolicies: [],
    }).success, false);
    assert.equal(ResolvedToolExecutionDescriptorSchema.safeParse({
      ...descriptor,
      networkPolicies: [],
      tool: { ...descriptor.tool, networkPolicyIds: [] },
    }).success, false);
  });
});

describe("Tool Gateway public errors", () => {
  it("accepts only finite codes paired with their documented status", () => {
    assert.equal(ToolGatewayErrorSchema.safeParse({
      code: "TOOL_ENDPOINT_NOT_APPROVED",
      message: "Endpoint is outside the approved policy",
      statusCode: 400,
    }).success, true);
    assert.equal(ToolGatewayErrorSchema.safeParse({
      code: "AI_TOOL_UNAVAILABLE",
      message: "Tool is unavailable",
      statusCode: 409,
    }).success, true);
    assert.equal(ToolGatewayErrorSchema.safeParse({
      code: "AI_TOOL_UNAVAILABLE",
      message: "Wrong status",
      statusCode: 400,
    }).success, false);
    assert.equal(ToolGatewayErrorSchema.safeParse({
      code: "DATABASE_ERROR",
      message: "Private implementation detail",
      statusCode: 500,
    }).success, false);
    assert.equal(ToolGatewayErrorSchema.safeParse({
      code: "AI_TOOL_INTERNAL_ERROR",
      message: "Safe",
      stack: "must not cross the public boundary",
      statusCode: 500,
    }).success, false);
  });
});
