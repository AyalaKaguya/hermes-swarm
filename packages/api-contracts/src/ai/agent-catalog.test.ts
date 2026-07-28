import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AgentDraftSchema,
  AgentCatalogErrorSchema,
  AgentVersionSchema,
  CreateAgentRequestSchema,
  PublishAgentDraftRequestSchema,
  ReplaceAgentDraftRequestSchema,
  UpdateAgentRequestSchema,
} from "./agent-catalog.js";
import { AGENT_GRAPH_SCHEMA_VERSION, AI_API_VERSION } from "./versions.js";

const ids = {
  agent: "11111111-1111-4111-8111-111111111111",
  deployment: "22222222-2222-4222-8222-222222222222",
  tool: "33333333-3333-4333-8333-333333333333",
  version: "44444444-4444-4444-8444-444444444444",
  workspace: "55555555-5555-4555-8555-555555555555",
} as const;

const emptyObjectSchema = {
  additionalProperties: false,
  properties: {},
  required: [],
  type: "object",
} as const;
const retry = {
  backoffMs: 100,
  maxAttempts: 1,
  strategy: "fixed",
} as const;
const modelReference = {
  apiVersion: AI_API_VERSION,
  capability: "chat",
  deploymentId: ids.deployment,
  modelId: "chat-primary",
  providerScope: "workspace",
} as const;
const toolReference = {
  toolDefinitionId: ids.tool,
  version: "1.0.0",
} as const;

function definition() {
  return {
    graph: {
      edges: [
        {
          id: "model-to-tool",
          kind: "default",
          sourceNodeId: "compose",
          targetNodeId: "lookup",
        },
        {
          id: "tool-to-end",
          kind: "default",
          sourceNodeId: "lookup",
          targetNodeId: "done",
        },
      ],
      entryNodeId: "compose",
      nodes: [
        {
          config: {
            instructions: "Compose a safe answer.",
            model: {
              apiVersion: AI_API_VERSION,
              mode: "pinned",
              model: modelReference,
            },
            schemaVersion: "hermes.agent-node.model/v1",
          },
          id: "compose",
          inputSchema: emptyObjectSchema,
          label: "Compose",
          outputSchema: emptyObjectSchema,
          retry,
          timeoutMs: 30_000,
          type: "model",
        },
        {
          config: {
            inputBindings: {},
            schemaVersion: "hermes.agent-node.tool/v1",
            tool: toolReference,
          },
          id: "lookup",
          inputSchema: emptyObjectSchema,
          label: "Lookup",
          outputSchema: emptyObjectSchema,
          retry,
          timeoutMs: 10_000,
          type: "tool",
        },
        {
          config: {
            outputPath: null,
            result: "success",
            schemaVersion: "hermes.agent-node.end/v1",
          },
          id: "done",
          inputSchema: emptyObjectSchema,
          label: "Done",
          outputSchema: emptyObjectSchema,
          retry,
          timeoutMs: 100,
          type: "end",
        },
      ],
      schemaVersion: AGENT_GRAPH_SCHEMA_VERSION,
      variables: [],
    },
    modelReferences: [modelReference],
    toolReferences: [toolReference],
  } as const;
}

describe("Agent catalog contracts", () => {
  it("creates one strict credential-free Draft without a client workspace id", () => {
    const payload = {
      description: "Answers support questions.",
      name: "Support agent",
      ...definition(),
    };

    assert.equal(CreateAgentRequestSchema.safeParse(payload).success, true);
    assert.equal(
      CreateAgentRequestSchema.safeParse({
        ...payload,
        workspaceId: ids.workspace,
      }).success,
      false,
    );
    assert.equal(
      CreateAgentRequestSchema.safeParse({
        ...payload,
        modelReferences: [
          { ...modelReference, apiKey: "must-not-cross-the-boundary" },
        ],
      }).success,
      false,
    );
  });

  it("requires declared Model and Tool references to exactly match the graph", () => {
    const payload = {
      description: "Answers support questions.",
      name: "Support agent",
      ...definition(),
    };

    assert.equal(
      CreateAgentRequestSchema.safeParse({
        ...payload,
        modelReferences: [],
      }).success,
      false,
    );
    assert.equal(
      CreateAgentRequestSchema.safeParse({
        ...payload,
        toolReferences: [toolReference, toolReference],
      }).success,
      false,
    );
    assert.equal(
      CreateAgentRequestSchema.safeParse({
        ...payload,
        toolReferences: [],
      }).success,
      false,
    );
  });

  it("uses positive optimistic revisions for every mutable write", () => {
    assert.equal(
      UpdateAgentRequestSchema.safeParse({
        expectedRevision: 1,
        name: "Updated Agent",
      }).success,
      true,
    );
    assert.equal(
      UpdateAgentRequestSchema.safeParse({ expectedRevision: 0, name: "No" })
        .success,
      false,
    );
    assert.equal(
      ReplaceAgentDraftRequestSchema.safeParse({
        expectedRevision: 1,
        ...definition(),
      }).success,
      true,
    );
    assert.equal(
      PublishAgentDraftRequestSchema.safeParse({ expectedRevision: -1 })
        .success,
      false,
    );
  });

  it("models immutable Version snapshots with the exact Draft revision", () => {
    const timestamps = {
      createdAt: "2026-07-25T10:00:00.000Z",
      updatedAt: "2026-07-25T10:01:00.000Z",
    };
    assert.equal(
      AgentDraftSchema.safeParse({
        agentId: ids.agent,
        apiVersion: AI_API_VERSION,
        revision: 7,
        ...timestamps,
        ...definition(),
      }).success,
      true,
    );
    const version = {
      agentId: ids.agent,
      apiVersion: AI_API_VERSION,
      contentDigest: "a".repeat(64),
      draftRevision: 7,
      id: ids.version,
      publishedAt: timestamps.createdAt,
      version: 3,
      ...definition(),
    };
    assert.equal(AgentVersionSchema.safeParse(version).success, true);
    assert.equal(
      AgentVersionSchema.safeParse({ ...version, draftRevision: 0 }).success,
      false,
    );
    assert.equal(
      AgentVersionSchema.safeParse({ ...version, credential: "secret" })
        .success,
      false,
    );
  });

  it("pairs stable public error codes with fixed HTTP statuses", () => {
    assert.equal(
      AgentCatalogErrorSchema.safeParse({
        code: "AI_AGENT_NOT_FOUND",
        message: "Agent not found",
        statusCode: 404,
      }).success,
      true,
    );
    assert.equal(
      AgentCatalogErrorSchema.safeParse({
        code: "AI_AGENT_VERSION_CONFLICT",
        message: "Version conflict",
        statusCode: 400,
      }).success,
      false,
    );
    assert.equal(
      AgentCatalogErrorSchema.safeParse({
        code: "AI_AGENT_ARCHIVED",
        message: "Archived Agents cannot publish new Versions",
        statusCode: 409,
      }).success,
      true,
    );
  });
});
