import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AI_API_VERSION } from "./versions.js";
import {
  CreatePlatformModelDeploymentRequestSchema,
  CreatePlatformModelProviderRequestSchema,
  CreateWorkspaceModelDeploymentRequestSchema,
  CreateWorkspaceModelProviderRequestSchema,
  PlatformModelDeploymentSchema,
  PlatformModelProviderSchema,
  PROVIDER_SECRET_MASK,
  ProviderSecretMetadataSchema,
  RotateProviderSecretRequestSchema,
  SetWorkspaceDefaultModelRequestSchema,
  UpdatePlatformModelProviderRequestSchema,
  UpdateWorkspaceModelGrantRequestSchema,
  WorkspaceDefaultModelSchema,
  WorkspaceModelGrantSchema,
  WorkspaceModelProviderSchema,
} from "./provider-catalog.js";

const ids = {
  defaultModel: "11111111-1111-4111-8111-111111111111",
  deployment: "22222222-2222-4222-8222-222222222222",
  grant: "33333333-3333-4333-8333-333333333333",
  provider: "44444444-4444-4444-8444-444444444444",
  secret: "55555555-5555-4555-8555-555555555555",
  workspace: "66666666-6666-4666-8666-666666666666",
} as const;

const timestamp = "2026-07-25T10:00:00.000Z";

const secretMetadata = {
  configured: true,
  id: ids.secret,
  mask: PROVIDER_SECRET_MASK,
  revision: 2,
  updatedAt: timestamp,
} as const;

const platformProvider = {
  apiVersion: AI_API_VERSION,
  baseUrl: "https://models.example.com/v1",
  createdAt: timestamp,
  driver: "openai-compatible",
  id: ids.provider,
  name: "Primary models",
  revision: 1,
  secret: secretMetadata,
  status: "enabled",
  updatedAt: timestamp,
} as const;

const deployment = {
  apiVersion: AI_API_VERSION,
  capability: "chat",
  createdAt: timestamp,
  id: ids.deployment,
  modelId: "chat-primary",
  name: "Primary chat",
  providerId: ids.provider,
  revision: 1,
  status: "enabled",
  updatedAt: timestamp,
} as const;

describe("provider catalog read contracts", () => {
  it("returns strict provider profiles without any credential envelope", () => {
    assert.equal(PlatformModelProviderSchema.safeParse(platformProvider).success, true);
    assert.equal(WorkspaceModelProviderSchema.safeParse({
      ...platformProvider,
      workspaceId: ids.workspace,
    }).success, true);

    for (const privateField of ["apiKey", "secretEnvelope", "config"] as const) {
      assert.equal(PlatformModelProviderSchema.safeParse({
        ...platformProvider,
        [privateField]: "must-not-leak",
      }).success, false);
    }
    assert.equal(ProviderSecretMetadataSchema.safeParse({
      ...secretMetadata,
      envelope: "enc:v2:current:private",
    }).success, false);
  });

  it("models missing and configured secrets without partial states", () => {
    assert.equal(ProviderSecretMetadataSchema.safeParse({
      configured: false,
      id: null,
      mask: null,
      revision: 0,
      updatedAt: null,
    }).success, true);
    assert.equal(ProviderSecretMetadataSchema.safeParse({
      ...secretMetadata,
      configured: false,
    }).success, false);
    assert.equal(ProviderSecretMetadataSchema.safeParse({
      ...secretMetadata,
      mask: "abcd",
    }).success, false);
  });

  it("freezes deployment, grant, and default response shapes", () => {
    assert.equal(PlatformModelDeploymentSchema.safeParse(deployment).success, true);
    assert.equal(PlatformModelDeploymentSchema.safeParse({
      ...deployment,
      config: { apiKey: "private" },
    }).success, false);
    assert.equal(WorkspaceModelGrantSchema.safeParse({
      apiVersion: AI_API_VERSION,
      createdAt: timestamp,
      enabled: true,
      expiresAt: null,
      id: ids.grant,
      platformDeploymentId: ids.deployment,
      revision: 1,
      updatedAt: timestamp,
      workspaceId: ids.workspace,
    }).success, true);
    assert.equal(WorkspaceDefaultModelSchema.safeParse({
      apiVersion: AI_API_VERSION,
      capability: "chat",
      createdAt: timestamp,
      id: ids.defaultModel,
      platformDeploymentId: ids.deployment,
      updatedAt: timestamp,
      workspaceDeploymentId: null,
      workspaceId: ids.workspace,
    }).success, true);
    assert.equal(WorkspaceDefaultModelSchema.safeParse({
      apiVersion: AI_API_VERSION,
      capability: "chat",
      createdAt: timestamp,
      id: ids.defaultModel,
      platformDeploymentId: ids.deployment,
      updatedAt: timestamp,
      workspaceDeploymentId: ids.deployment,
      workspaceId: ids.workspace,
    }).success, false);
  });
});

describe("provider catalog write contracts", () => {
  it("accepts API keys only in explicit write-only requests", () => {
    const createProvider = CreatePlatformModelProviderRequestSchema.safeParse({
      baseUrl: "https://models.example.com/v1",
      driver: "openai-compatible",
      name: "Primary models",
      secret: { apiKey: "test-api-key" },
    });
    assert.equal(createProvider.success, true);
    assert.equal(createProvider.success && createProvider.data.status, "disabled");
    assert.equal(RotateProviderSecretRequestSchema.safeParse({
      apiKey: "rotated-api-key",
    }).success, true);
    assert.equal(UpdatePlatformModelProviderRequestSchema.safeParse({
      apiKey: "must-use-the-secret-endpoint",
    }).success, false);
    assert.equal(PlatformModelProviderSchema.safeParse({
      ...platformProvider,
      secret: { apiKey: "must-not-leak" },
    }).success, false);
  });

  it("rejects secrets that the encryption boundary cannot safely store", () => {
    for (const apiKey of [
      "   ",
      "line-one\nline-two",
      "密".repeat(3_000),
    ]) {
      assert.equal(
        RotateProviderSecretRequestSchema.safeParse({ apiKey }).success,
        false,
      );
    }
    assert.equal(
      RotateProviderSecretRequestSchema.safeParse({ apiKey: "valid-secret" })
        .success,
      true,
    );
  });

  it("does not accept a client supplied workspace in Workspace bodies", () => {
    const workspaceProvider = {
      baseUrl: "https://models.example.com/v1",
      driver: "openai-compatible",
      name: "Workspace models",
    } as const;
    assert.equal(CreateWorkspaceModelProviderRequestSchema.safeParse(
      workspaceProvider,
    ).success, true);
    assert.equal(CreateWorkspaceModelProviderRequestSchema.safeParse({
      ...workspaceProvider,
      workspaceId: ids.workspace,
    }).success, false);

    const workspaceDeployment = {
      capability: "chat",
      modelId: "chat-primary",
      name: "Primary chat",
    } as const;
    assert.equal(CreateWorkspaceModelDeploymentRequestSchema.safeParse(
      workspaceDeployment,
    ).success, true);
    assert.equal(CreateWorkspaceModelDeploymentRequestSchema.safeParse({
      ...workspaceDeployment,
      workspaceId: ids.workspace,
    }).success, false);
  });

  it("requires meaningful patches and an unambiguous default", () => {
    assert.equal(UpdatePlatformModelProviderRequestSchema.safeParse({}).success, false);
    assert.equal(UpdateWorkspaceModelGrantRequestSchema.safeParse({}).success, false);
    const createDeployment = CreatePlatformModelDeploymentRequestSchema.safeParse({
      capability: "chat",
      modelId: "chat-primary",
      name: "Primary chat",
    });
    assert.equal(createDeployment.success, true);
    assert.equal(createDeployment.success && createDeployment.data.status, "disabled");
    assert.equal(SetWorkspaceDefaultModelRequestSchema.safeParse({
      capability: "chat",
      platformDeploymentId: ids.deployment,
    }).success, true);
    assert.equal(SetWorkspaceDefaultModelRequestSchema.safeParse({
      capability: "chat",
    }).success, false);
    assert.equal(SetWorkspaceDefaultModelRequestSchema.safeParse({
      capability: "chat",
      platformDeploymentId: ids.deployment,
      workspaceDeploymentId: ids.deployment,
    }).success, false);
    assert.equal(SetWorkspaceDefaultModelRequestSchema.safeParse({
      capability: "chat",
      platformDeploymentId: ids.deployment,
      workspaceId: ids.workspace,
    }).success, false);
  });
});
