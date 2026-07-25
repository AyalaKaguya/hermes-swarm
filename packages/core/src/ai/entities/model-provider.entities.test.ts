import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { PlatformModelDeployment } from "./platform-model-deployment.entity.js";
import { PlatformModelProvider } from "./platform-model-provider.entity.js";
import { WorkspaceModelDefault } from "./workspace-model-default.entity.js";
import { WorkspaceModelDeployment } from "./workspace-model-deployment.entity.js";
import { WorkspaceModelGrant } from "./workspace-model-grant.entity.js";
import { WorkspaceModelProvider } from "./workspace-model-provider.entity.js";

const entityTables = new Map<Function, string>([
  [PlatformModelProvider, "platform_model_providers"],
  [WorkspaceModelProvider, "workspace_model_providers"],
  [PlatformModelDeployment, "platform_model_deployments"],
  [WorkspaceModelDeployment, "workspace_model_deployments"],
  [WorkspaceModelGrant, "workspace_model_grants"],
  [WorkspaceModelDefault, "workspace_model_defaults"],
]);

const workspaceEntities = [
  WorkspaceModelProvider,
  WorkspaceModelDeployment,
  WorkspaceModelGrant,
  WorkspaceModelDefault,
];

describe("model provider catalog entity metadata", () => {
  it("keeps platform and workspace resources in separate tables", () => {
    const tables = getMetadataArgsStorage().tables;

    for (const [entity, tableName] of entityTables) {
      const table = tables.find((candidate) => candidate.target === entity);

      assert.ok(table, `${entity.name} must be registered as an entity`);
      assert.equal(table.name, tableName);
    }
  });

  it("makes every workspace ownership column explicit and non-null", () => {
    const columns = getMetadataArgsStorage().columns;

    for (const entity of workspaceEntities) {
      const workspaceColumn = columns.find(
        (column) =>
          column.target === entity && column.propertyName === "workspaceId",
      );

      assert.ok(workspaceColumn, `${entity.name} must declare workspaceId`);
      assert.equal(workspaceColumn.options.name, "workspace_id");
      assert.notEqual(workspaceColumn.options.nullable, true);
    }

    for (const entity of [PlatformModelProvider, PlatformModelDeployment]) {
      assert.equal(
        columns.some(
          (column) =>
            column.target === entity && column.propertyName === "workspaceId",
        ),
        false,
      );
    }
  });

  it("defines catalog identity and workspace-safe unique indexes", () => {
    const indices = getMetadataArgsStorage().indices;
    const expected = new Map<string, readonly string[]>([
      ["UQ_platform_model_providers_name", ["name"]],
      ["UQ_platform_model_providers_secret_id", ["secretId"]],
      [
        "UQ_workspace_model_providers_workspace_name",
        ["workspaceId", "name"],
      ],
      ["UQ_workspace_model_providers_secret_id", ["secretId"]],
      [
        "UQ_workspace_model_providers_workspace_id_id",
        ["workspaceId", "id"],
      ],
      [
        "UQ_platform_model_deployments_provider_model",
        ["providerId", "modelId", "capability"],
      ],
      [
        "UQ_platform_model_deployments_id_capability",
        ["id", "capability"],
      ],
      [
        "UQ_platform_model_deployments_provider_name",
        ["providerId", "name"],
      ],
      [
        "UQ_workspace_model_deployments_provider_model",
        ["workspaceId", "providerId", "modelId", "capability"],
      ],
      [
        "UQ_workspace_model_deployments_workspace_id_id",
        ["workspaceId", "id"],
      ],
      [
        "UQ_workspace_model_deployments_workspace_id_capability",
        ["workspaceId", "id", "capability"],
      ],
      [
        "UQ_workspace_model_deployments_provider_name",
        ["workspaceId", "providerId", "name"],
      ],
      [
        "UQ_workspace_model_grants_workspace_deployment",
        ["workspaceId", "platformDeploymentId"],
      ],
      [
        "UQ_workspace_model_defaults_workspace_capability",
        ["workspaceId", "capability"],
      ],
    ]);

    for (const [name, columns] of expected) {
      const index = indices.find((candidate) => candidate.name === name);

      assert.ok(index, `${name} must exist`);
      assert.equal(index.unique, true);
      assert.deepEqual(index.columns, columns);
    }
  });

  it("keeps secret envelopes internal and catalogs disabled by default", () => {
    const columns = getMetadataArgsStorage().columns;

    for (const entity of [PlatformModelProvider, WorkspaceModelProvider]) {
      const secretEnvelope = columns.find(
        (column) =>
          column.target === entity && column.propertyName === "secretEnvelope",
      );
      const status = columns.find(
        (column) => column.target === entity && column.propertyName === "status",
      );
      const revision = columns.find(
        (column) =>
          column.target === entity && column.propertyName === "revision",
      );

      assert.ok(secretEnvelope);
      assert.equal(secretEnvelope.options.select, false);
      assert.equal(status?.options.default, "disabled");
      assert.equal(revision?.options.default, 1);
    }

    for (const entity of [PlatformModelDeployment, WorkspaceModelDeployment]) {
      const status = columns.find(
        (column) => column.target === entity && column.propertyName === "status",
      );
      const modelId = columns.find(
        (column) => column.target === entity && column.propertyName === "modelId",
      );

      assert.equal(status?.options.default, "disabled");
      assert.equal(modelId?.options.length, 240);
    }
  });

  it("propagates workspace and capability through security-sensitive joins", () => {
    const joinColumns = getMetadataArgsStorage().joinColumns;
    const relationColumns = (entity: Function, propertyName: string) =>
      joinColumns
        .filter(
          (column) =>
            column.target === entity && column.propertyName === propertyName,
        )
        .map((column) => [column.name, column.referencedColumnName]);

    assert.deepEqual(
      relationColumns(WorkspaceModelDeployment, "provider"),
      [
        ["workspace_id", "workspaceId"],
        ["provider_id", "id"],
      ],
    );
    assert.deepEqual(
      relationColumns(WorkspaceModelDefault, "platformDeployment"),
      [
        ["platform_deployment_id", "id"],
        ["capability", "capability"],
      ],
    );
    assert.deepEqual(
      relationColumns(WorkspaceModelDefault, "platformGrant"),
      [
        ["workspace_id", "workspaceId"],
        ["platform_deployment_id", "platformDeploymentId"],
      ],
    );
    assert.deepEqual(
      relationColumns(WorkspaceModelDefault, "workspaceDeployment"),
      [
        ["workspace_id", "workspaceId"],
        ["workspace_deployment_id", "id"],
        ["capability", "capability"],
      ],
    );
  });

  it("does not encode RLS, policy, or PostgreSQL workspace GUC behavior", () => {
    const metadata = getMetadataArgsStorage();
    const namesAndChecks = [
      ...metadata.tables
        .filter((table) => entityTables.has(table.target as Function))
        .map((table) => table.name ?? ""),
      ...metadata.indices
        .filter((index) => entityTables.has(index.target as Function))
        .map((index) => index.name ?? ""),
      ...metadata.checks
        .filter((check) => entityTables.has(check.target as Function))
        .flatMap((check) => [check.name ?? "", String(check.expression)]),
    ].join(" ");

    assert.doesNotMatch(
      namesAndChecks,
      /row.level|\brls\b|policy|current_setting|set_config|app\.workspace_id/i,
    );
  });
});
