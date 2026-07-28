import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from "@nestjs/common";
import type { CreatePlatformToolVersionRequest } from "@hermes-swarm/api-contracts/ai";
import { ToolCatalogService } from "./tool-catalog.service.js";
import { ToolConnectionSecretService } from "./tool-connection-secret.service.js";

describe("ToolCatalogService", () => {
  it("fails closed when Workspace B guesses Workspace A Connection and Grant ids", async () => {
    const state = createState();
    const fixture = await provisionExternalTool(state);

    state.workspaceId = WORKSPACE_B;
    assert.deepEqual(await state.service.listWorkspaceToolConnections(), []);
    assert.deepEqual(await state.service.listWorkspaceToolGrants(), []);
    await assert.rejects(
      () => state.service.updateWorkspaceToolConnection(fixture.connection.id, {
        expectedRevision: fixture.connection.revision,
        name: "Guessed connection",
      }),
      NotFoundException,
    );
    await assert.rejects(
      () => state.service.rotateWorkspaceToolConnectionSecret(
        fixture.connection.id,
        { value: "replacement-secret" },
      ),
      NotFoundException,
    );
    await assert.rejects(
      () => state.service.updateWorkspaceToolGrant(fixture.grant.id, {
        enabled: false,
        expectedRevision: fixture.grant.revision,
      }),
      NotFoundException,
    );
    await assert.rejects(
      () => state.service.bindWorkspaceToolGrantConnection(fixture.grant.id, {
        connectionId: fixture.connection.id,
        expectedRevision: fixture.grant.revision,
      }),
      NotFoundException,
    );
    await assert.rejects(
      () => state.service.resolveWorkspaceTool(
        fixture.definition.id,
        fixture.version.version,
      ),
      ConflictException,
    );
  });

  it("keeps Connection credentials write-only and excludes endpoints and secrets from resolution", async () => {
    const state = createState();
    const plaintext = "private-tool-credential";
    const fixture = await provisionExternalTool(state, { plaintext });
    const persisted = state.connections.find(
      ({ id }) => id === fixture.connection.id,
    )!;

    assert.match(String(persisted.secretEnvelope), /^enc:v2:current:/);
    assert.equal(String(persisted.secretEnvelope).includes(plaintext), false);

    const connectionJson = JSON.stringify(fixture.connection);
    assert.equal(connectionJson.includes(plaintext), false);
    assert.equal(connectionJson.includes(String(persisted.secretEnvelope)), false);
    assert.equal(connectionJson.includes("secretEnvelope"), false);
    assert.equal(fixture.connection.secret.configured, true);

    const resolved = await state.service.resolveWorkspaceTool(
      fixture.definition.id,
      fixture.version.version,
    );
    assert.deepEqual(resolved.driverConfig, {
      method: "GET",
      path: "/tickets",
    });
    assert.equal(resolved.connectionRevision, fixture.connection.revision);
    assert.equal(resolved.grantRevision, fixture.grant.revision);
    assert.equal(resolved.toolDefinitionRevision, fixture.definition.revision);
    assert.equal(resolved.toolVersionRevision, fixture.version.revision);
    assert.deepEqual(resolved.networkPolicies, [{
      id: fixture.policy.id,
      revision: fixture.policy.revision,
    }]);

    const resolvedJson = JSON.stringify(resolved);
    assert.equal(resolvedJson.includes("baseUrl"), false);
    assert.equal(resolvedJson.includes("tools.example.com"), false);
    assert.equal(resolvedJson.includes("secret"), false);
    assert.equal(resolvedJson.includes(plaintext), false);
    assert.equal(resolvedJson.includes(String(persisted.secretEnvelope)), false);
    assert.equal(resolvedJson.includes(String(persisted.secretId)), false);
  });

  it("pins the exact Tool Definition revision that passed readiness validation", async () => {
    const state = createState();
    const fixture = await provisionExternalTool(state);
    const repository = state.repositories.ToolDefinition;
    const originalFindOne = repository.findOne.bind(repository);
    let definitionReads = 0;

    repository.findOne = async (options: { where: AnyRow }) => {
      const definition = await originalFindOne(options);
      definitionReads += 1;
      if (!definition || definitionReads === 1) {
        return definition ? { ...definition } : null;
      }
      return {
        ...definition,
        description: "Concurrent unvalidated revision",
        revision: definition.revision + 1,
        status: "disabled",
      };
    };

    const resolved = await state.service.resolveWorkspaceTool(
      fixture.definition.id,
      fixture.version.version,
    );

    assert.equal(definitionReads, 1);
    assert.equal(resolved.tool.description, fixture.definition.description);
    assert.equal(resolved.toolDefinitionRevision, fixture.definition.revision);
  });

  it("allows HTTP Tool endpoints only with the explicit development opt-in", async () => {
    const payload = {
      host: "tools.example.com",
      name: "Development HTTP policy",
      pathPrefix: "/gateway",
      port: 80,
      scheme: "http" as const,
      status: "enabled" as const,
    };

    await assert.rejects(
      () =>
        createState({ NODE_ENV: "development" }).service
          .createPlatformToolNetworkPolicy(payload),
      BadRequestException,
    );
    for (const NODE_ENV of ["test", "production"]) {
      await assert.rejects(
        () =>
          createState({
            "ai.allowHttpInDevelopment": true,
            NODE_ENV,
          }).service.createPlatformToolNetworkPolicy(payload),
        BadRequestException,
      );
    }

    const development = createState({
      "ai.allowHttpInDevelopment": true,
      NODE_ENV: "development",
    });
    const policy = await development.service.createPlatformToolNetworkPolicy(
      payload,
    );
    const connection = await development.service.createWorkspaceToolConnection({
      authType: "none",
      baseUrl: "http://tools.example.com/gateway",
      driverType: "http",
      name: "Development HTTP connection",
      networkPolicyId: policy.id,
      status: "enabled",
    });

    assert.equal(policy.scheme, "http");
    assert.equal(connection.baseUrl, "http://tools.example.com/gateway");
  });

  it("supports internal Grants without a Connection and requires an approved Connection for external Grants", async () => {
    const state = createState();
    const internal = await provisionInternalTool(state);

    const internalResolved = await state.service.resolveWorkspaceTool(
      internal.definition.id,
      internal.version.version,
    );
    assert.equal(internalResolved.connectionRevision, null);
    assert.deepEqual(internalResolved.networkPolicies, []);
    assert.equal("connectionId" in internalResolved.tool, false);
    await assert.rejects(
      () => state.service.bindWorkspaceToolGrantConnection(internal.grant.id, {
        connectionId: randomUUID(),
        expectedRevision: internal.grant.revision,
      }),
      BadRequestException,
    );

    const external = await provisionExternalTool(state, { activate: false });
    assert.equal(external.grant.configured, false);
    await assert.rejects(
      () => state.service.updateWorkspaceToolGrant(external.grant.id, {
        enabled: true,
        expectedRevision: external.grant.revision,
      }),
      ConflictException,
    );

    const bound = await state.service.bindWorkspaceToolGrantConnection(
      external.grant.id,
      {
        connectionId: external.connection.id,
        expectedRevision: external.grant.revision,
      },
    );
    assert.equal(bound.configured, true);
    const enabled = await state.service.updateWorkspaceToolGrant(bound.id, {
      enabled: true,
      expectedRevision: bound.revision,
    });
    const externalResolved = await state.service.resolveWorkspaceTool(
      external.definition.id,
      external.version.version,
    );
    assert.equal(externalResolved.tool.connectionId, external.connection.id);
    assert.equal(externalResolved.grantRevision, enabled.revision);
  });

  it("revalidates revocation, expiry, and every dependency on each resolution", async () => {
    const state = createState();
    const fixture = await provisionExternalTool(state);
    const resolve = () => state.service.resolveWorkspaceTool(
      fixture.definition.id,
      fixture.version.version,
    );

    await assert.doesNotReject(resolve);

    const revoked = await state.service.updateWorkspaceToolGrant(
      fixture.grant.id,
      { enabled: false, expectedRevision: fixture.grant.revision },
    );
    await assert.rejects(resolve, ConflictException);
    const restored = await state.service.updateWorkspaceToolGrant(revoked.id, {
      enabled: true,
      expectedRevision: revoked.revision,
    });
    assert.equal(restored.enabled, true);

    const grantRow = state.grants.find(({ id }) => id === restored.id)!;
    grantRow.expiresAt = new Date("2020-01-01T00:00:00.000Z");
    await assert.rejects(resolve, ConflictException);
    grantRow.expiresAt = null;

    const disabledDefinition = await state.service.updatePlatformToolDefinition(
      fixture.definition.id,
      { expectedRevision: fixture.definition.revision, status: "disabled" },
    );
    await assert.rejects(resolve, ConflictException);
    await state.service.updatePlatformToolDefinition(fixture.definition.id, {
      expectedRevision: disabledDefinition.revision,
      status: "enabled",
    });

    const disabledVersion = await state.service.updatePlatformToolVersionStatus(
      fixture.definition.id,
      fixture.version.version,
      { expectedRevision: fixture.version.revision, status: "disabled" },
    );
    await assert.rejects(resolve, ConflictException);
    await state.service.updatePlatformToolVersionStatus(
      fixture.definition.id,
      fixture.version.version,
      { expectedRevision: disabledVersion.revision, status: "published" },
    );

    const disabledPolicy = await state.service.updatePlatformToolNetworkPolicy(
      fixture.policy.id,
      { expectedRevision: fixture.policy.revision, status: "disabled" },
    );
    await assert.rejects(resolve, ConflictException);
    await state.service.updatePlatformToolNetworkPolicy(fixture.policy.id, {
      expectedRevision: disabledPolicy.revision,
      status: "enabled",
    });

    const disabledConnection = await state.service.updateWorkspaceToolConnection(
      fixture.connection.id,
      { expectedRevision: fixture.connection.revision, status: "disabled" },
    );
    await assert.rejects(resolve, ConflictException);
    await state.service.updateWorkspaceToolConnection(fixture.connection.id, {
      expectedRevision: disabledConnection.revision,
      status: "enabled",
    });

    await assert.doesNotReject(resolve);
  });

  it("normalizes unordered Tool Version arrays before hashing, persistence, and response", async () => {
    const state = createState();
    const firstDefinition = await createDefinition(state, "normalized.tool.first");
    const secondDefinition = await createDefinition(state, "normalized.tool.second");
    const firstPolicy = await createPolicy(
      state,
      "First policy",
      "first-tools.example.com",
    );
    const secondPolicy = await createPolicy(
      state,
      "Second policy",
      "second-tools.example.com",
    );
    const policyIds = [firstPolicy.id, secondPolicy.id].sort();
    const permissions = ["analytics.query", "tickets.read"].sort();
    const redactionPaths = ["/metadata/secret", "/token"].sort();
    const firstPayload = externalVersionPayload(
      [secondPolicy.id, firstPolicy.id],
      {
        outputRedactionPaths: ["/token", "/metadata/secret"],
        requiredPermissions: ["tickets.read", "analytics.query"],
      },
    );
    const secondPayload = externalVersionPayload(
      [firstPolicy.id, secondPolicy.id],
      {
        outputRedactionPaths: ["/metadata/secret", "/token"],
        requiredPermissions: ["analytics.query", "tickets.read"],
      },
    );

    const first = await state.service.createPlatformToolVersion(
      firstDefinition.id,
      firstPayload,
    );
    const second = await state.service.createPlatformToolVersion(
      secondDefinition.id,
      secondPayload,
    );

    assert.equal(first.contentDigest, second.contentDigest);
    for (const version of [first, second]) {
      assert.deepEqual(version.networkPolicyIds, policyIds);
      assert.deepEqual(version.requiredPermissions, permissions);
      assert.deepEqual(version.outputRedactionPaths, redactionPaths);
    }
    for (const row of state.toolVersions) {
      assert.deepEqual(row.requiredPermissions, permissions);
      assert.deepEqual(row.outputRedactionPaths, redactionPaths);
      const persistedPolicyIds = state.versionPolicies
        .filter(({ toolDefinitionVersionId }) =>
          toolDefinitionVersionId === row.id
        )
        .map(({ networkPolicyId }) => networkPolicyId);
      assert.deepEqual(persistedPolicyIds, policyIds);
    }
  });

  it("does not perform transport calls while creating or resolving control-plane data", async () => {
    const originalFetch = globalThis.fetch;
    let networkCalls = 0;
    globalThis.fetch = (async () => {
      networkCalls += 1;
      throw new Error("Control-plane code attempted an outbound request");
    }) as typeof fetch;

    try {
      const state = createState();
      const fixture = await provisionExternalTool(state);
      await state.service.resolveWorkspaceTool(
        fixture.definition.id,
        fixture.version.version,
      );
      assert.equal(networkCalls, 0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("rejects stale optimistic revisions for Platform and Workspace mutations", async () => {
    const state = createState();
    const fixture = await provisionExternalTool(state);

    const definition = await state.service.updatePlatformToolDefinition(
      fixture.definition.id,
      {
        displayName: "Updated tool",
        expectedRevision: fixture.definition.revision,
      },
    );
    assert.equal(definition.revision, fixture.definition.revision + 1);
    await assert.rejects(
      () => state.service.updatePlatformToolDefinition(fixture.definition.id, {
        description: "Stale update",
        expectedRevision: fixture.definition.revision,
      }),
      ConflictException,
    );

    const connection = await state.service.updateWorkspaceToolConnection(
      fixture.connection.id,
      {
        expectedRevision: fixture.connection.revision,
        name: "Updated connection",
      },
    );
    assert.equal(connection.revision, fixture.connection.revision + 1);
    await assert.rejects(
      () => state.service.updateWorkspaceToolConnection(fixture.connection.id, {
        expectedRevision: fixture.connection.revision,
        name: "Stale connection",
      }),
      ConflictException,
    );

    const grant = await state.service.updateWorkspaceToolGrant(
      fixture.grant.id,
      { enabled: false, expectedRevision: fixture.grant.revision },
    );
    assert.equal(grant.revision, fixture.grant.revision + 1);
    await assert.rejects(
      () => state.service.bindWorkspaceToolGrantConnection(fixture.grant.id, {
        connectionId: fixture.connection.id,
        expectedRevision: fixture.grant.revision,
      }),
      ConflictException,
    );
  });
});

const WORKSPACE_A = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_B = "22222222-2222-4222-8222-222222222222";
const FIXED_TIME = new Date("2026-07-25T10:00:00.000Z");

type AnyRow = Record<string, any>;

function createState(configOverrides: Record<string, unknown> = {}) {
  const definitions: AnyRow[] = [];
  const toolVersions: AnyRow[] = [];
  const networkPolicies: AnyRow[] = [];
  const versionPolicies: AnyRow[] = [];
  const connections: AnyRow[] = [];
  const grants: AnyRow[] = [];
  const repositories = {
    ToolDefinition: fakeRepository(definitions),
    ToolDefinitionNetworkPolicy: fakeRepository(versionPolicies),
    ToolDefinitionVersion: fakeRepository(toolVersions),
    ToolNetworkPolicy: fakeRepository(networkPolicies),
    WorkspaceToolConnection: fakeRepository(connections),
    WorkspaceToolGrant: fakeRepository(grants),
  };
  let workspaceId = WORKSPACE_A;
  const config = testConfig(configOverrides);
  const service = new ToolCatalogService(
    repositories.ToolDefinition as never,
    repositories.ToolDefinitionVersion as never,
    repositories.ToolNetworkPolicy as never,
    repositories.ToolDefinitionNetworkPolicy as never,
    repositories.WorkspaceToolConnection as never,
    repositories.WorkspaceToolGrant as never,
    {
      async transaction<T>(operation: (manager: {
        getRepository(entity: { name: keyof typeof repositories }): unknown;
      }) => Promise<T>) {
        return operation({
          getRepository(entity) {
            const repository = repositories[entity.name];
            if (!repository) {
              throw new Error(`Unexpected repository: ${entity.name}`);
            }
            return repository;
          },
        });
      },
    } as never,
    {
      current: () => ({ scopeLevel: "workspace", workspaceId }),
    } as never,
    new ToolConnectionSecretService(config as never),
    config as never,
  );
  return {
    connections,
    definitions,
    grants,
    networkPolicies,
    repositories,
    service,
    toolVersions,
    versionPolicies,
    get workspaceId() {
      return workspaceId;
    },
    set workspaceId(value: string) {
      workspaceId = value;
    },
  };
}

async function provisionInternalTool(state: ReturnType<typeof createState>) {
  const definition = await createDefinition(state, "support.tickets.internal");
  const version = await state.service.createPlatformToolVersion(
    definition.id,
    internalVersionPayload(),
  );
  const grant = await state.service.createWorkspaceToolGrant({
    enabled: true,
    toolDefinitionId: definition.id,
    toolVersion: version.version,
  });
  return { definition, grant, version };
}

async function provisionExternalTool(
  state: ReturnType<typeof createState>,
  options: { activate?: boolean; plaintext?: string } = {},
) {
  const definition = await createDefinition(
    state,
    `support.tickets.external.${state.definitions.length}`,
  );
  const policy = await createPolicy(
    state,
    `Tool policy ${state.networkPolicies.length}`,
    "tools.example.com",
  );
  const version = await state.service.createPlatformToolVersion(
    definition.id,
    externalVersionPayload([policy.id]),
  );
  const connection = await state.service.createWorkspaceToolConnection({
    authType: "bearer",
    baseUrl: "https://tools.example.com/gateway",
    driverType: "http",
    name: `Tool connection ${state.connections.length}`,
    networkPolicyId: policy.id,
    secret: { value: options.plaintext ?? "private-tool-credential" },
    status: "enabled",
  });
  let grant = await state.service.createWorkspaceToolGrant({
    enabled: false,
    toolDefinitionId: definition.id,
    toolVersion: version.version,
  });
  if (options.activate !== false) {
    grant = await state.service.bindWorkspaceToolGrantConnection(grant.id, {
      connectionId: connection.id,
      expectedRevision: grant.revision,
    });
    grant = await state.service.updateWorkspaceToolGrant(grant.id, {
      enabled: true,
      expectedRevision: grant.revision,
    });
  }
  return { connection, definition, grant, policy, version };
}

function createDefinition(
  state: ReturnType<typeof createState>,
  name: string,
) {
  return state.service.createPlatformToolDefinition({
    description: "Queries an approved support ticket projection.",
    displayName: "Support tickets",
    name,
    status: "enabled",
  });
}

function createPolicy(
  state: ReturnType<typeof createState>,
  name: string,
  host: string,
) {
  return state.service.createPlatformToolNetworkPolicy({
    host,
    name,
    pathPrefix: "/gateway",
    port: 443,
    scheme: "https",
    status: "enabled",
  });
}

function internalVersionPayload(): CreatePlatformToolVersionRequest {
  return {
    allowsArtifact: false,
    driverConfig: { handlerKey: "support.tickets.query" },
    driverType: "internal",
    idempotency: "notRequired",
    inputSchema: objectSchema(),
    maxResponseBytes: 32_768,
    networkPolicyIds: [],
    outputRedactionPaths: ["/metadata/internal"],
    outputSchema: objectSchema(),
    requiredPermissions: ["tickets.read"],
    retry: { backoffMs: 0, maxAttempts: 1, strategy: "fixed" },
    schemaVersion: "hermes.tool-definition/v1",
    sideEffect: "none",
    status: "published",
    timeoutMs: 5_000,
    version: "1.0.0",
  };
}

function externalVersionPayload(
  networkPolicyIds: string[],
  overrides: Partial<CreatePlatformToolVersionRequest> = {},
): CreatePlatformToolVersionRequest {
  return {
    allowsArtifact: false,
    driverConfig: { method: "GET", path: "/tickets" },
    driverType: "http",
    idempotency: "notRequired",
    inputSchema: objectSchema(),
    maxResponseBytes: 32_768,
    networkPolicyIds,
    outputRedactionPaths: ["/metadata/internal"],
    outputSchema: objectSchema(),
    requiredPermissions: ["tickets.read"],
    retry: { backoffMs: 0, maxAttempts: 1, strategy: "fixed" },
    schemaVersion: "hermes.tool-definition/v1",
    sideEffect: "none",
    status: "published",
    timeoutMs: 5_000,
    version: "1.0.0",
    ...overrides,
  };
}

function objectSchema() {
  return {
    additionalProperties: false as const,
    properties: {},
    required: [],
    type: "object" as const,
  };
}

function testConfig(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    "NODE_ENV": "test",
    "ai.allowHttpInDevelopment": false,
    "ai.requireHttps": true,
    "settings.encryptionKey": "tool-catalog-test-master-key",
    "settings.encryptionKeyId": "current",
    "settings.previousEncryptionKeys": {},
    ...overrides,
  };
  return {
    get(name: string, fallback?: unknown) {
      return values[name] ?? fallback;
    },
  };
}

function fakeRepository(rows: AnyRow[]) {
  const saveOne = (value: AnyRow) => {
    const existing = rows.find(({ id }) => id === value.id);
    const entity = existing ?? {
      createdAt: value.createdAt ?? new Date(FIXED_TIME),
      id: value.id ?? randomUUID(),
    };
    Object.assign(entity, value, {
      updatedAt: value.updatedAt ?? new Date(FIXED_TIME),
    });
    if (!existing) rows.push(entity);
    return entity;
  };

  return {
    create(value: AnyRow) {
      return { ...value };
    },
    async find(options: { order?: AnyRow; where?: AnyRow } = {}) {
      const found = rows.filter((row) => matches(row, options.where ?? {}));
      const [orderKey] = Object.keys(options.order ?? {});
      if (!orderKey) return found;
      const direction = options.order?.[orderKey] === "DESC" ? -1 : 1;
      return found.sort(
        (left, right) =>
          String(left[orderKey]).localeCompare(String(right[orderKey])) *
          direction,
      );
    },
    async findBy(criteria: AnyRow) {
      return rows.filter((row) => matches(row, criteria));
    },
    async findOne(options: { where: AnyRow }) {
      return rows.find((row) => matches(row, options.where)) ?? null;
    },
    async findOneByOrFail(criteria: AnyRow) {
      const row = rows.find((candidate) => matches(candidate, criteria));
      if (!row) throw new Error("Entity not found");
      return row;
    },
    async save(value: AnyRow | AnyRow[]) {
      return Array.isArray(value)
        ? value.map((item) => saveOne(item))
        : saveOne(value);
    },
    async update(criteria: AnyRow, patch: AnyRow) {
      const row = rows.find((candidate) => matches(candidate, criteria));
      if (!row) return { affected: 0 };
      for (const [key, value] of Object.entries(patch)) {
        row[key] = typeof value === "function"
          ? Number(row[key] ?? 0) + 1
          : value;
      }
      row.updatedAt = new Date(FIXED_TIME.getTime() + 60_000);
      return { affected: 1 };
    },
  };
}

function matches(row: AnyRow, criteria: AnyRow) {
  return Object.entries(criteria).every(([key, expected]) => {
    if (
      expected &&
      typeof expected === "object" &&
      (expected as { _type?: unknown })._type === "in"
    ) {
      return (expected as { _value: unknown[] })._value.includes(row[key]);
    }
    return row[key] === expected;
  });
}
