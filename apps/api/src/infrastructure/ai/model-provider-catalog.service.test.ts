import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import { ModelProviderCatalogService } from "./model-provider-catalog.service.js";
import { ModelProviderDriverRegistry } from "./model-provider-driver.registry.js";
import { ProviderSecretService } from "./provider-secret.service.js";

describe("ModelProviderCatalogService", () => {
  it("forces Workspace ownership from the trusted context on every query", async () => {
    const state = createState();
    const created = await state.service.createWorkspaceProvider({
      baseUrl: "https://models.example.com/v1",
      driver: "openai-compatible",
      name: "Workspace A",
      status: "disabled",
    });

    assert.equal(created.workspaceId, state.workspaceId);
    assert.equal(state.workspaceProviders[0]?.workspaceId, state.workspaceId);
    state.workspaceId = WORKSPACE_B;
    assert.deepEqual(await state.service.listWorkspaceProviders(), []);
    await assert.rejects(
      () => state.service.getWorkspaceProvider(created.id),
      NotFoundException,
    );
  });

  it("keeps credentials write-only and requires one before enabling", async () => {
    const state = createState();
    const provider = await state.service.createWorkspaceProvider({
      baseUrl: "https://models.example.com/v1",
      driver: "openai-compatible",
      name: "Workspace models",
      status: "disabled",
    });

    await assert.rejects(
      () => state.service.updateWorkspaceProvider(provider.id, {
        status: "enabled",
      }),
      BadRequestException,
    );
    const rotated = await state.service.rotateWorkspaceProviderSecret(
      provider.id,
      { apiKey: "private-provider-key" },
    );
    assert.equal(rotated.secret.configured, true);
    assert.equal(JSON.stringify(rotated).includes("private-provider-key"), false);
    assert.equal(JSON.stringify(rotated).includes("enc:v2"), false);

    const enabled = await state.service.updateWorkspaceProvider(provider.id, {
      status: "enabled",
    });
    assert.equal(enabled.status, "enabled");
    assert.equal(enabled.revision, 3);
    assert.equal(state.workspaceProviders[0]?.secretRevision, 1);
    assert.match(String(state.workspaceProviders[0]?.secretEnvelope), /^enc:v2:current:/);
  });

  it("resolves an enabled Workspace default without leaking provider details", async () => {
    const state = createState();
    const provider = await state.service.createWorkspaceProvider({
      baseUrl: "https://models.example.com/v1",
      driver: "openai-compatible",
      name: "Workspace models",
      secret: { apiKey: "private-provider-key" },
      status: "enabled",
    });
    const deployment = await state.service.createWorkspaceDeployment(
      provider.id,
      {
        capability: "chat",
        modelId: "chat-primary",
        name: "Primary chat",
        status: "enabled",
      },
    );
    await state.service.setWorkspaceDefault({
      capability: "chat",
      workspaceDeploymentId: deployment.id,
    });

    assert.deepEqual(await state.service.resolveWorkspaceDefault("chat"), {
      apiVersion: "hermes.ai/v1",
      capability: "chat",
      deploymentId: deployment.id,
      modelId: "chat-primary",
      providerScope: "workspace",
    });
  });

  it("requires a live explicit grant before resolving a platform default", async () => {
    const state = createState();
    const provider = await state.service.createPlatformProvider({
      baseUrl: "https://models.example.com/v1",
      driver: "openai-compatible",
      name: "Platform models",
      secret: { apiKey: "private-provider-key" },
      status: "enabled",
    });
    const deployment = await state.service.createPlatformDeployment(
      provider.id,
      {
        capability: "chat",
        modelId: "chat-platform",
        name: "Platform chat",
        status: "enabled",
      },
    );

    await assert.rejects(
      () => state.service.setWorkspaceDefault({
        capability: "chat",
        platformDeploymentId: deployment.id,
      }),
      ConflictException,
    );
    const grant = await state.service.createWorkspaceGrant(state.workspaceId, {
      enabled: true,
      expiresAt: "2099-07-25T10:00:00.000Z",
      platformDeploymentId: deployment.id,
    });
    await state.service.setWorkspaceDefault({
      capability: "chat",
      platformDeploymentId: deployment.id,
    });
    assert.equal(
      (await state.service.resolveWorkspaceDefault("chat")).providerScope,
      "platform",
    );

    const disabledGrant = await state.service.updateWorkspaceGrant(
      state.workspaceId,
      grant.id,
      { enabled: false },
    );
    assert.equal(disabledGrant.revision, 2);
    await assert.rejects(
      () => state.service.resolveWorkspaceDefault("chat"),
      ConflictException,
    );
  });

  it("rejects expired enabled grants and disabled provider dependencies", async () => {
    const state = createState();
    const provider = await state.service.createPlatformProvider({
      baseUrl: "https://models.example.com/v1",
      driver: "openai-compatible",
      name: "Platform models",
      secret: { apiKey: "private-provider-key" },
      status: "enabled",
    });
    const deployment = await state.service.createPlatformDeployment(
      provider.id,
      {
        capability: "embedding",
        modelId: "embedding-primary",
        name: "Primary embedding",
        status: "enabled",
      },
    );
    await assert.rejects(
      () => state.service.createWorkspaceGrant(state.workspaceId, {
        enabled: true,
        expiresAt: "2020-01-01T00:00:00.000Z",
        platformDeploymentId: deployment.id,
      }),
      BadRequestException,
    );

    await state.service.updatePlatformProvider(provider.id, {
      status: "disabled",
    });
    await assert.rejects(
      () => state.service.createWorkspaceGrant(state.workspaceId, {
        enabled: true,
        platformDeploymentId: deployment.id,
      }),
      ConflictException,
    );
  });
});

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";

function createState() {
  const platformProviders: AnyRow[] = [];
  const workspaceProviders: AnyRow[] = [];
  const platformDeployments: AnyRow[] = [];
  const workspaceDeployments: AnyRow[] = [];
  const workspaceGrants: AnyRow[] = [];
  const workspaceDefaults: AnyRow[] = [];
  const state = {
    workspaceId: WORKSPACE_A,
    platformProviders,
    workspaceProviders,
    platformDeployments,
    workspaceDeployments,
    workspaceGrants,
    workspaceDefaults,
  };
  const registry = new ModelProviderDriverRegistry([{
    descriptor: {
      capabilities: ["chat", "embedding"],
      displayName: "OpenAI-compatible",
      driver: "openai-compatible",
    },
    normalizeConfiguration(input) {
      const baseUrl = (input as { baseUrl: string }).baseUrl.replace(/\/+$/, "");
      return { baseUrl };
    },
  }]);
  const secrets = new ProviderSecretService({
    get(name: string, fallback?: unknown) {
      const values: Record<string, unknown> = {
        "settings.encryptionKey": "provider-test-master-key",
        "settings.encryptionKeyId": "current",
        "settings.previousEncryptionKeys": {},
      };
      return values[name] ?? fallback;
    },
  } as never);
  const service = new ModelProviderCatalogService(
    fakeRepository(platformProviders) as never,
    fakeRepository(workspaceProviders) as never,
    fakeRepository(platformDeployments) as never,
    fakeRepository(workspaceDeployments) as never,
    fakeRepository(workspaceGrants) as never,
    fakeRepository(workspaceDefaults) as never,
    { current: () => ({ scopeLevel: "workspace", workspaceId: state.workspaceId }) } as never,
    registry,
    secrets,
  );
  return {
    platformDeployments,
    platformProviders,
    service,
    workspaceDefaults,
    workspaceDeployments,
    workspaceGrants,
    workspaceProviders,
    get workspaceId() {
      return state.workspaceId;
    },
    set workspaceId(value: string) {
      state.workspaceId = value;
    },
  };
}

type AnyRow = Record<string, any>;

function fakeRepository(rows: AnyRow[]) {
  return {
    create(value: AnyRow) {
      return { ...value };
    },
    async delete(criteria: AnyRow) {
      const index = rows.findIndex((row) => matches(row, criteria));
      if (index < 0) return { affected: 0 };
      rows.splice(index, 1);
      return { affected: 1 };
    },
    async find(options: { order?: AnyRow; where?: AnyRow } = {}) {
      const found = rows.filter((row) => matches(row, options.where ?? {}));
      const [orderKey] = Object.keys(options.order ?? {});
      return orderKey
        ? found.sort((left, right) => String(left[orderKey]).localeCompare(String(right[orderKey])))
        : found;
    },
    async findOne(options: { where: AnyRow }) {
      return rows.find((row) => matches(row, options.where)) ?? null;
    },
    async save(value: AnyRow) {
      const now = new Date("2026-07-25T10:00:00.000Z");
      const entity = {
        createdAt: value.createdAt ?? now,
        id: value.id ?? randomUUID(),
        updatedAt: now,
        ...value,
      };
      const index = rows.findIndex((row) => row.id === entity.id);
      if (index < 0) rows.push(entity);
      else rows[index] = entity;
      return entity;
    },
    async update(criteria: AnyRow, patch: AnyRow) {
      const row = rows.find((candidate) => matches(candidate, criteria));
      if (!row) return { affected: 0 };
      for (const [key, value] of Object.entries(patch)) {
        if (typeof value === "function") {
          row[key] = Number(row[key] ?? 0) + 1;
        } else {
          row[key] = value;
        }
      }
      row.updatedAt = new Date("2026-07-25T10:01:00.000Z");
      return { affected: 1 };
    },
  };
}

function matches(row: AnyRow, criteria: AnyRow) {
  return Object.entries(criteria).every(([key, value]) => row[key] === value);
}
