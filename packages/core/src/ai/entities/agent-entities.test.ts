import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getMetadataArgsStorage } from "typeorm";
import { AgentDraft } from "./agent-draft.entity.js";
import { AgentVersion } from "./agent-version.entity.js";
import { Agent } from "./agent.entity.js";

const entityTables = new Map<Function, string>([
  [Agent, "agents"],
  [AgentDraft, "agent_drafts"],
  [AgentVersion, "agent_versions"],
]);

describe("Agent catalog entity metadata", () => {
  it("registers stable Agent, mutable Draft, and immutable Version tables", () => {
    const tables = getMetadataArgsStorage().tables;
    for (const [entity, tableName] of entityTables) {
      const table = tables.find((candidate) => candidate.target === entity);
      assert.ok(table, `${entity.name} must be an entity`);
      assert.equal(table.name, tableName);
    }
  });

  it("makes workspace ownership explicit on every record", () => {
    const columns = getMetadataArgsStorage().columns;
    for (const entity of entityTables.keys()) {
      const workspaceId = columns.find(
        (column) =>
          column.target === entity && column.propertyName === "workspaceId",
      );
      assert.ok(workspaceId, `${entity.name} must declare workspaceId`);
      assert.equal(workspaceId.options.name, "workspace_id");
      assert.notEqual(workspaceId.options.nullable, true);
    }
  });

  it("allows exactly one Draft and one Version number per Agent", () => {
    const indices = getMetadataArgsStorage().indices;
    const expected = new Map<string, readonly string[]>([
      ["UQ_agents_workspace_name", ["workspaceId", "name"]],
      ["UQ_agents_workspace_id_id", ["workspaceId", "id"]],
      [
        "UQ_agent_drafts_workspace_agent",
        ["workspaceId", "agentId"],
      ],
      [
        "UQ_agent_versions_workspace_agent_version",
        ["workspaceId", "agentId", "version"],
      ],
      [
        "UQ_agent_versions_workspace_agent_draft_revision",
        ["workspaceId", "agentId", "draftRevision"],
      ],
    ]);

    for (const [name, columns] of expected) {
      const index = indices.find((candidate) => candidate.name === name);
      assert.ok(index, `${name} must exist`);
      assert.equal(index.unique, true);
      assert.deepEqual(index.columns, columns);
    }
  });

  it("binds Drafts and Versions to the Agent in the same workspace", () => {
    const joins = getMetadataArgsStorage().joinColumns;
    const relationColumns = (entity: Function, propertyName: string) =>
      joins
        .filter(
          (column) =>
            column.target === entity && column.propertyName === propertyName,
        )
        .map((column) => [column.name, column.referencedColumnName]);

    for (const entity of [AgentDraft, AgentVersion]) {
      assert.deepEqual(relationColumns(entity, "agent"), [
        ["workspace_id", "workspaceId"],
        ["agent_id", "id"],
      ]);
    }
  });

  it("marks every published content column non-updatable", () => {
    const immutable = new Set([
      "agentId",
      "apiVersion",
      "contentDigest",
      "draftRevision",
      "graph",
      "modelReferences",
      "toolReferences",
      "version",
      "workspaceId",
    ]);
    const columns = getMetadataArgsStorage().columns.filter(
      (column) =>
        column.target === AgentVersion && immutable.has(column.propertyName),
    );

    assert.equal(columns.length, immutable.size);
    for (const column of columns) {
      assert.equal(column.options.update, false, column.propertyName);
    }
  });

  it("keeps the Draft API version default aligned with the migration", () => {
    const apiVersion = getMetadataArgsStorage().columns.find(
      (column) =>
        column.target === AgentDraft && column.propertyName === "apiVersion",
    );
    assert.ok(apiVersion);
    assert.equal(apiVersion.options.default, "hermes.ai/v1");
    assert.equal(apiVersion.options.update, false);
  });

  it("represents positive revisions, digests, and JSON shape checks", () => {
    const checks = getMetadataArgsStorage().checks
      .filter((check) => entityTables.has(check.target as Function))
      .map((check) => check.name);
    for (const name of [
      "CHK_agents_revision",
      "CHK_agent_drafts_revision",
      "CHK_agent_drafts_api_version",
      "CHK_agent_drafts_json_shapes",
      "CHK_agent_versions_version",
      "CHK_agent_versions_api_version",
      "CHK_agent_versions_draft_revision",
      "CHK_agent_versions_digest",
      "CHK_agent_versions_json_shapes",
    ]) {
      assert.ok(checks.includes(name), `${name} must be represented`);
    }
  });
});
