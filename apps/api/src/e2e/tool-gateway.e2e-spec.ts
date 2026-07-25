import "reflect-metadata";
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { ConflictException, NotFoundException } from "@nestjs/common";
import type { CreatePlatformToolVersionRequest } from "@hermes-swarm/api-contracts/ai";
import {
  ToolDefinition,
  ToolDefinitionNetworkPolicy,
  ToolDefinitionVersion,
  ToolNetworkPolicy,
  Workspace,
  WorkspaceToolConnection,
  WorkspaceToolGrant,
} from "@hermes-swarm/core";
import { DataSource } from "typeorm";
import { DATABASE_ENTITIES } from "../common/database/database-entities.js";
import { WorkspaceContextService } from "../common/database/workspace-context.service.js";
import { WorkspaceModelBaseline2026071500001 } from "../common/database/migrations/202607150001-WorkspaceModelBaseline.js";
import { CanonicalRuntimePreferences2026071700001 } from "../common/database/migrations/202607170001-CanonicalRuntimePreferences.js";
import { AuditLogs2026071700002 } from "../common/database/migrations/202607170002-AuditLogs.js";
import { CredentialVersion2026072000001 } from "../common/database/migrations/2026072000001-CredentialVersion.js";
import { RemoveWorkspaceRls2026072200001 } from "../common/database/migrations/2026072200001-RemoveWorkspaceRls.js";
import { PlatformTicketInboxPermissions2026072300001 } from "../common/database/migrations/2026072300001-PlatformTicketInboxPermissions.js";
import { ObjectStorageFiles2026072400001 } from "../common/database/migrations/2026072400001-ObjectStorageFiles.js";
import { ModelProviderCatalog2026072500001 } from "../common/database/migrations/2026072500001-ModelProviderCatalog.js";
import { AnalyticsTicketExplorerPermissions2026072500002 } from "../common/database/migrations/2026072500002-AnalyticsTicketExplorerPermissions.js";
import { ControlledToolGateway2026072500003 } from "../common/database/migrations/2026072500003-ControlledToolGateway.js";
import { ToolCatalogService } from "../infrastructure/ai/tool-catalog.service.js";
import { ToolConnectionSecretService } from "../infrastructure/ai/tool-connection-secret.service.js";

const databaseUrl = process.env.POSTGRES_TEST_URL;

if (!databaseUrl) {
  throw new Error(
    "POSTGRES_TEST_URL is required for controlled Tool Gateway e2e tests",
  );
}

const ids = {
  workspaceA: "70000000-0000-4000-8000-000000000001",
  workspaceB: "70000000-0000-4000-8000-000000000002",
} as const;

describe("controlled Tool Gateway e2e", { concurrency: false }, () => {
  let dataSource: DataSource;
  let fixture: Awaited<ReturnType<typeof provisionExternalTool>>;
  let service: ToolCatalogService;
  let workspaceContext: WorkspaceContextService;

  before(async () => {
    dataSource = new DataSource({
      type: "postgres",
      url: databaseUrl,
      entities: [...DATABASE_ENTITIES],
      migrations: [
        WorkspaceModelBaseline2026071500001,
        CanonicalRuntimePreferences2026071700001,
        AuditLogs2026071700002,
        CredentialVersion2026072000001,
        RemoveWorkspaceRls2026072200001,
        PlatformTicketInboxPermissions2026072300001,
        ObjectStorageFiles2026072400001,
        ModelProviderCatalog2026072500001,
        AnalyticsTicketExplorerPermissions2026072500002,
        ControlledToolGateway2026072500003,
      ],
      migrationsRun: false,
      synchronize: false,
    });
    await dataSource.initialize();
    await dataSource.query("DROP SCHEMA IF EXISTS public CASCADE");
    await dataSource.query("CREATE SCHEMA public");
    await dataSource.runMigrations();

    await dataSource.getRepository(Workspace).save([
      workspace(ids.workspaceA, "tool-gateway-a"),
      workspace(ids.workspaceB, "tool-gateway-b"),
    ]);

    workspaceContext = new WorkspaceContextService();
    const config = testConfig();
    service = new ToolCatalogService(
      dataSource.getRepository(ToolDefinition),
      dataSource.getRepository(ToolDefinitionVersion),
      dataSource.getRepository(ToolNetworkPolicy),
      dataSource.getRepository(ToolDefinitionNetworkPolicy),
      dataSource.getRepository(WorkspaceToolConnection),
      dataSource.getRepository(WorkspaceToolGrant),
      dataSource,
      workspaceContext,
      new ToolConnectionSecretService(config as never),
      config as never,
    );
    fixture = await provisionExternalTool();
  });

  after(async () => {
    await dataSource?.destroy();
  });

  it("fails closed when Workspace B guesses Workspace A Connection and Grant ids", async () => {
    assert.deepEqual(
      await runInWorkspace(ids.workspaceB, () =>
        service.listWorkspaceToolConnections()),
      [],
    );
    assert.deepEqual(
      await runInWorkspace(ids.workspaceB, () =>
        service.listWorkspaceToolGrants()),
      [],
    );
    await assert.rejects(
      runInWorkspace(ids.workspaceB, () =>
        service.updateWorkspaceToolConnection(fixture.connection.id, {
          expectedRevision: fixture.connection.revision,
          name: "Guessed connection",
        })),
      NotFoundException,
    );
    await assert.rejects(
      runInWorkspace(ids.workspaceB, () =>
        service.rotateWorkspaceToolConnectionSecret(fixture.connection.id, {
          value: "replacement-secret",
        })),
      NotFoundException,
    );
    await assert.rejects(
      runInWorkspace(ids.workspaceB, () =>
        service.updateWorkspaceToolGrant(fixture.grant.id, {
          enabled: false,
          expectedRevision: fixture.grant.revision,
        })),
      NotFoundException,
    );
    await assert.rejects(
      runInWorkspace(ids.workspaceB, () =>
        service.bindWorkspaceToolGrantConnection(fixture.grant.id, {
          connectionId: fixture.connection.id,
          expectedRevision: fixture.grant.revision,
        })),
      NotFoundException,
    );
    await assert.rejects(
      runInWorkspace(ids.workspaceB, () =>
        service.resolveWorkspaceTool(
          fixture.definition.id,
          fixture.version.version,
        )),
      isToolUnavailable,
    );
  });

  it("resolves revision-pinned driver metadata without endpoint or credential material", async () => {
    const stored = (await dataSource.query(
      `
        SELECT
          "base_url" AS "baseUrl",
          "secret_envelope" AS "secretEnvelope",
          "secret_id" AS "secretId"
        FROM "workspace_tool_connections"
        WHERE "id" = $1
      `,
      [fixture.connection.id],
    )) as Array<{
      baseUrl: string;
      secretEnvelope: string;
      secretId: string;
    }>;
    assert.equal(stored.length, 1);
    assert.match(stored[0].secretEnvelope, /^enc:v2:current:/);
    assert.equal(stored[0].secretEnvelope.includes(fixture.plaintext), false);

    const resolved = await runInWorkspace(ids.workspaceA, () =>
      service.resolveWorkspaceTool(
        fixture.definition.id,
        fixture.version.version,
      ));
    assert.deepEqual(resolved.driverConfig, {
      method: "GET",
      path: "/tickets",
    });
    assert.equal(resolved.connectionRevision, fixture.connection.revision);
    assert.equal(resolved.grantRevision, fixture.grant.revision);
    assert.equal(
      resolved.toolDefinitionRevision,
      fixture.definition.revision,
    );
    assert.equal(resolved.toolVersionRevision, fixture.version.revision);
    assert.deepEqual(resolved.networkPolicies, [
      { id: fixture.policy.id, revision: fixture.policy.revision },
    ]);

    const serialized = JSON.stringify(resolved);
    assert.equal(serialized.includes("baseUrl"), false);
    assert.equal(serialized.includes(stored[0].baseUrl), false);
    assert.equal(serialized.includes("secret"), false);
    assert.equal(serialized.includes(fixture.plaintext), false);
    assert.equal(serialized.includes(stored[0].secretEnvelope), false);
    assert.equal(serialized.includes(stored[0].secretId), false);
  });

  it("revalidates revocation, expiry, and disabled dependencies on every resolution", async () => {
    const resolve = () =>
      runInWorkspace(ids.workspaceA, () =>
        service.resolveWorkspaceTool(
          fixture.definition.id,
          fixture.version.version,
        ));
    await assert.doesNotReject(resolve);

    let grant = await runInWorkspace(ids.workspaceA, () =>
      service.updateWorkspaceToolGrant(fixture.grant.id, {
        enabled: false,
        expectedRevision: fixture.grant.revision,
      }));
    await assert.rejects(resolve, isToolUnavailable);
    grant = await runInWorkspace(ids.workspaceA, () =>
      service.updateWorkspaceToolGrant(grant.id, {
        enabled: true,
        expectedRevision: grant.revision,
      }));

    await dataSource.getRepository(WorkspaceToolGrant).update(
      { id: grant.id, workspaceId: ids.workspaceA },
      { expiresAt: new Date("2020-01-01T00:00:00.000Z") },
    );
    await assert.rejects(resolve, isToolUnavailable);
    await dataSource.getRepository(WorkspaceToolGrant).update(
      { id: grant.id, workspaceId: ids.workspaceA },
      { expiresAt: null },
    );

    let definition = await service.updatePlatformToolDefinition(
      fixture.definition.id,
      {
        expectedRevision: fixture.definition.revision,
        status: "disabled",
      },
    );
    await assert.rejects(resolve, isToolUnavailable);
    definition = await service.updatePlatformToolDefinition(definition.id, {
      expectedRevision: definition.revision,
      status: "enabled",
    });

    let version = await service.updatePlatformToolVersionStatus(
      fixture.definition.id,
      fixture.version.version,
      { expectedRevision: fixture.version.revision, status: "disabled" },
    );
    await assert.rejects(resolve, isToolUnavailable);
    version = await service.updatePlatformToolVersionStatus(
      fixture.definition.id,
      version.version,
      { expectedRevision: version.revision, status: "published" },
    );

    let policy = await service.updatePlatformToolNetworkPolicy(
      fixture.policy.id,
      { expectedRevision: fixture.policy.revision, status: "disabled" },
    );
    await assert.rejects(resolve, isToolUnavailable);
    policy = await service.updatePlatformToolNetworkPolicy(policy.id, {
      expectedRevision: policy.revision,
      status: "enabled",
    });

    let connection = await runInWorkspace(ids.workspaceA, () =>
      service.updateWorkspaceToolConnection(fixture.connection.id, {
        expectedRevision: fixture.connection.revision,
        status: "disabled",
      }));
    await assert.rejects(resolve, isToolUnavailable);
    connection = await runInWorkspace(ids.workspaceA, () =>
      service.updateWorkspaceToolConnection(connection.id, {
        expectedRevision: connection.revision,
        status: "enabled",
      }));

    const restored = await resolve();
    assert.equal(restored.grantRevision, grant.revision);
    assert.equal(restored.toolDefinitionRevision, definition.revision);
    assert.equal(restored.toolVersionRevision, version.revision);
    assert.equal(restored.connectionRevision, connection.revision);
    assert.deepEqual(restored.networkPolicies, [
      { id: policy.id, revision: policy.revision },
    ]);
  });

  it("enforces immutable Tool Version content, draft rollback, and policy links", async () => {
    const secondaryPolicy = await service.createPlatformToolNetworkPolicy({
      host: "secondary-tools.example.com",
      name: "Secondary tool network",
      pathPrefix: "/gateway",
      port: 443,
      scheme: "https",
      status: "enabled",
    });

    await assert.rejects(
      dataSource.query(
        `UPDATE "tool_definition_versions" SET "driver_config" = '{"method":"POST","path":"/tickets"}'::jsonb WHERE "id" = $1`,
        [fixture.version.id],
      ),
      (error: unknown) => isDatabaseError(error, "P0001"),
    );
    await assert.rejects(
      dataSource.query(
        `UPDATE "tool_definition_versions" SET "status" = 'draft' WHERE "id" = $1`,
        [fixture.version.id],
      ),
      (error: unknown) => isDatabaseError(error, "P0001"),
    );
    await assert.rejects(
      dataSource.query(
        `
          INSERT INTO "tool_definition_network_policies"
            ("tool_definition_version_id", "network_policy_id")
          VALUES ($1, $2)
        `,
        [fixture.version.id, secondaryPolicy.id],
      ),
      (error: unknown) => isDatabaseError(error, "P0001"),
    );
    await assert.rejects(
      dataSource.query(
        `
          UPDATE "tool_definition_network_policies"
          SET "network_policy_id" = $2
          WHERE "tool_definition_version_id" = $1
        `,
        [fixture.version.id, secondaryPolicy.id],
      ),
      (error: unknown) => isDatabaseError(error, "P0001"),
    );
    await assert.rejects(
      dataSource.query(
        `
          DELETE FROM "tool_definition_network_policies"
          WHERE "tool_definition_version_id" = $1
            AND "network_policy_id" = $2
        `,
        [fixture.version.id, fixture.policy.id],
      ),
      (error: unknown) => isDatabaseError(error, "P0001"),
    );

    const persisted = await dataSource.getRepository(ToolDefinitionVersion)
      .findOneByOrFail({ id: fixture.version.id });
    assert.deepEqual(persisted.driverConfig, {
      method: "GET",
      path: "/tickets",
    });
    assert.equal(persisted.status, "published");
    const links = await dataSource.getRepository(ToolDefinitionNetworkPolicy)
      .findBy({ toolDefinitionVersionId: fixture.version.id });
    assert.deepEqual(
      links.map(({ networkPolicyId }) => networkPolicyId),
      [fixture.policy.id],
    );
  });

  it("rejects a cross-Workspace Connection through both service lookup and the composite foreign key", async () => {
    const workspaceBGrant = await runInWorkspace(ids.workspaceB, () =>
      service.createWorkspaceToolGrant({
        enabled: false,
        toolDefinitionId: fixture.definition.id,
        toolVersion: fixture.version.version,
      }));

    await assert.rejects(
      runInWorkspace(ids.workspaceB, () =>
        service.bindWorkspaceToolGrantConnection(workspaceBGrant.id, {
          connectionId: fixture.connection.id,
          expectedRevision: workspaceBGrant.revision,
        })),
      NotFoundException,
    );
    await assert.rejects(
      dataSource.query(
        `
          UPDATE "workspace_tool_grants"
          SET "connection_id" = $1
          WHERE "id" = $2 AND "workspace_id" = $3
        `,
        [fixture.connection.id, workspaceBGrant.id, ids.workspaceB],
      ),
      (error: unknown) => isDatabaseError(error, "23503"),
    );

    const persisted = await dataSource.getRepository(WorkspaceToolGrant)
      .findOneByOrFail({ id: workspaceBGrant.id });
    assert.equal(persisted.connectionId, null);
    assert.equal(persisted.workspaceId, ids.workspaceB);
  });

  async function provisionExternalTool() {
    const plaintext = "private-tool-credential";
    const definition = await service.createPlatformToolDefinition({
      description: "Queries an approved support ticket projection.",
      displayName: "Support tickets",
      name: "support.tickets.external",
      status: "enabled",
    });
    const policy = await service.createPlatformToolNetworkPolicy({
      host: "tools.example.com",
      name: "Support tools network",
      pathPrefix: "/gateway",
      port: 443,
      scheme: "https",
      status: "enabled",
    });
    const version = await service.createPlatformToolVersion(
      definition.id,
      externalVersionPayload([policy.id]),
    );
    const connection = await runInWorkspace(ids.workspaceA, () =>
      service.createWorkspaceToolConnection({
        authType: "bearer",
        baseUrl: "https://tools.example.com/gateway",
        driverType: "http",
        name: "Support ticket gateway",
        networkPolicyId: policy.id,
        secret: { value: plaintext },
        status: "enabled",
      }));
    let grant = await runInWorkspace(ids.workspaceA, () =>
      service.createWorkspaceToolGrant({
        enabled: false,
        toolDefinitionId: definition.id,
        toolVersion: version.version,
      }));
    grant = await runInWorkspace(ids.workspaceA, () =>
      service.bindWorkspaceToolGrantConnection(grant.id, {
        connectionId: connection.id,
        expectedRevision: grant.revision,
      }));
    grant = await runInWorkspace(ids.workspaceA, () =>
      service.updateWorkspaceToolGrant(grant.id, {
        enabled: true,
        expectedRevision: grant.revision,
      }));
    return { connection, definition, grant, plaintext, policy, version };
  }

  function runInWorkspace<T>(workspaceId: string, work: () => T): T {
    return workspaceContext.run(
      { scopeLevel: "workspace", workspaceId },
      work,
    );
  }
});

function externalVersionPayload(
  networkPolicyIds: string[],
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

function workspace(id: string, slug: string) {
  return {
    id,
    name: slug,
    slug,
    status: "active" as const,
    subdomain: null,
  };
}

function testConfig() {
  const values: Record<string, unknown> = {
    "ai.requireHttps": true,
    "settings.encryptionKey": "tool-gateway-e2e-master-key",
    "settings.encryptionKeyId": "current",
    "settings.previousEncryptionKeys": {},
  };
  return {
    get(name: string, fallback?: unknown) {
      return values[name] ?? fallback;
    },
  };
}

function isToolUnavailable(error: unknown) {
  if (!(error instanceof ConflictException)) return false;
  const response = error.getResponse();
  return (
    typeof response === "object" &&
    response !== null &&
    "code" in response &&
    response.code === "AI_TOOL_UNAVAILABLE"
  );
}

function isDatabaseError(error: unknown, code: string) {
  const candidate = error as {
    code?: string;
    driverError?: { code?: string };
  };
  return candidate.code === code || candidate.driverError?.code === code;
}
