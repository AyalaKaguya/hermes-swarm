import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { ToolDefinitionNetworkPolicy } from "./tool-definition-network-policy.entity.js";
import { ToolDefinitionVersion } from "./tool-definition-version.entity.js";
import { ToolDefinition } from "./tool-definition.entity.js";
import { ToolNetworkPolicy } from "./tool-network-policy.entity.js";
import { WorkspaceToolConnection } from "./tool-workspace-connection.entity.js";
import { WorkspaceToolGrant } from "./tool-workspace-grant.entity.js";

const entityTables = new Map<Function, string>([
  [ToolDefinition, "tool_definitions"],
  [ToolDefinitionVersion, "tool_definition_versions"],
  [ToolNetworkPolicy, "tool_network_policies"],
  [ToolDefinitionNetworkPolicy, "tool_definition_network_policies"],
  [WorkspaceToolConnection, "workspace_tool_connections"],
  [WorkspaceToolGrant, "workspace_tool_grants"],
]);

describe("controlled tool gateway entity metadata", () => {
  it("registers separate catalog, version, policy, connection, and grant tables", () => {
    const tables = getMetadataArgsStorage().tables;

    for (const [entity, tableName] of entityTables) {
      const table = tables.find((candidate) => candidate.target === entity);
      assert.ok(table, `${entity.name} must be an entity`);
      assert.equal(table.name, tableName);
    }
  });

  it("makes Workspace connection and grant ownership explicit and non-null", () => {
    const columns = getMetadataArgsStorage().columns;

    for (const entity of [WorkspaceToolConnection, WorkspaceToolGrant]) {
      const workspaceId = columns.find(
        (column) =>
          column.target === entity && column.propertyName === "workspaceId",
      );
      assert.ok(workspaceId, `${entity.name} must declare workspaceId`);
      assert.equal(workspaceId.options.name, "workspace_id");
      assert.notEqual(workspaceId.options.nullable, true);
    }
  });

  it("defines stable identity and lookup indexes", () => {
    const indices = getMetadataArgsStorage().indices;
    const expected = new Map<string, readonly string[]>([
      ["UQ_tool_definitions_name", ["name"]],
      [
        "UQ_tool_definition_versions_definition_version",
        ["toolDefinitionId", "version"],
      ],
      ["UQ_tool_network_policies_name", ["name"]],
      [
        "UQ_tool_network_policies_endpoint",
        ["scheme", "host", "port", "pathPrefix"],
      ],
      [
        "UQ_tool_definition_network_policies_version_policy",
        ["toolDefinitionVersionId", "networkPolicyId"],
      ],
      [
        "UQ_workspace_tool_connections_id_workspace_id",
        ["id", "workspaceId"],
      ],
      [
        "UQ_workspace_tool_connections_workspace_name",
        ["workspaceId", "name"],
      ],
      [
        "UQ_workspace_tool_grants_workspace_tool_version",
        ["workspaceId", "toolDefinitionId", "toolVersion"],
      ],
    ]);

    for (const [name, columns] of expected) {
      const index = indices.find((candidate) => candidate.name === name);
      assert.ok(index, `${name} must exist`);
      assert.equal(index.unique, true);
      assert.deepEqual(index.columns, columns);
    }
  });

  it("keeps connection credentials hidden and disabled by default", () => {
    const columns = getMetadataArgsStorage().columns;
    const secretEnvelope = columns.find(
      (column) =>
        column.target === WorkspaceToolConnection &&
        column.propertyName === "secretEnvelope",
    );
    const connectionStatus = columns.find(
      (column) =>
        column.target === WorkspaceToolConnection &&
        column.propertyName === "status",
    );
    const grantEnabled = columns.find(
      (column) =>
        column.target === WorkspaceToolGrant &&
        column.propertyName === "enabled",
    );
    const toolSchemaVersion = columns.find(
      (column) =>
        column.target === ToolDefinitionVersion &&
        column.propertyName === "schemaVersion",
    );

    assert.equal(secretEnvelope?.options.select, false);
    assert.equal(connectionStatus?.options.default, "disabled");
    assert.equal(grantEnabled?.options.default, false);
    assert.equal(toolSchemaVersion?.options.name, "schema_version");
    assert.equal(toolSchemaVersion?.options.length, 48);
    assert.equal(
      toolSchemaVersion?.options.default,
      "hermes.tool-definition/v1",
    );
  });

  it("keeps synchronize-time checks aligned with migration invariants", () => {
    const checks = getMetadataArgsStorage().checks
      .filter((check) => entityTables.has(check.target as Function))
      .map((check) => check.name);
    for (const name of [
      "CHK_tool_definitions_status",
      "CHK_tool_definition_versions_lock_state",
      "CHK_tool_definition_versions_schema_version",
      "CHK_tool_network_policies_port",
      "CHK_workspace_tool_connections_secret_state",
      "CHK_workspace_tool_connections_enabled_secret",
      "CHK_workspace_tool_grants_revision",
    ]) {
      assert.ok(checks.includes(name), `${name} must be represented in metadata`);
    }
  });

  it("propagates Workspace and immutable version identity through grants", () => {
    const joinColumns = getMetadataArgsStorage().joinColumns;
    const relationColumns = (entity: Function, propertyName: string) =>
      joinColumns
        .filter(
          (column) =>
            column.target === entity && column.propertyName === propertyName,
        )
        .map((column) => [column.name, column.referencedColumnName]);

    assert.deepEqual(
      relationColumns(WorkspaceToolGrant, "toolDefinitionVersion"),
      [
        ["tool_definition_id", "toolDefinitionId"],
        ["tool_version", "version"],
      ],
    );
    assert.deepEqual(relationColumns(WorkspaceToolGrant, "connection"), [
      ["connection_id", "id"],
      ["workspace_id", "workspaceId"],
    ]);
    assert.deepEqual(
      relationColumns(WorkspaceToolConnection, "networkPolicy"),
      [["network_policy_id", undefined]],
    );
  });

  it("does not encode RLS or PostgreSQL workspace GUC behavior", () => {
    const metadata = getMetadataArgsStorage();
    const searchable = [
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
      searchable,
      /row.level|\brls\b|policy.*current_setting|set_config|app\.workspace_id/i,
    );
  });
});
