import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  AGENT_GRAPH_SCHEMA_VERSION,
  AI_API_VERSION,
  AI_ERROR_SCHEMA_VERSION,
  AgentGraphSchema,
  AiErrorSchema,
  EXECUTION_SCOPE_SCHEMA_VERSION,
  ExecutionScopeSchema,
  ModelBindingSchema,
  ModelReferenceSchema,
  RUN_EVENT_SCHEMA_VERSION,
  RunEventSchema,
  TOOL_DEFINITION_SCHEMA_VERSION,
  ToolDefinitionSchema,
  redactAiError,
} from "./index.js";

const ids = {
  account: "11111111-1111-4111-8111-111111111111",
  agentVersion: "22222222-2222-4222-8222-222222222222",
  artifact: "33333333-3333-4333-8333-333333333333",
  checkpoint: "44444444-4444-4444-8444-444444444444",
  deployment: "55555555-5555-4555-8555-555555555555",
  event: "66666666-6666-4666-8666-666666666666",
  grant: "77777777-7777-4777-8777-777777777777",
  provider: "88888888-8888-4888-8888-888888888888",
  run: "99999999-9999-4999-8999-999999999999",
  session: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  tool: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  workspace: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
} as const;

const emptyObjectSchema = {
  additionalProperties: false,
  properties: {},
  required: [],
  type: "object",
} as const;

const chatModel = {
  apiVersion: AI_API_VERSION,
  capability: "chat",
  deploymentId: ids.deployment,
  modelId: "chat-primary",
  providerScope: "workspace",
} as const;

const retry = { backoffMs: 100, maxAttempts: 1, strategy: "fixed" } as const;

function modelNode(id: string) {
  return {
    config: {
      instructions: "Answer using the supplied input.",
      model: { apiVersion: AI_API_VERSION, mode: "pinned", model: chatModel },
      schemaVersion: "hermes.agent-node.model/v1",
    },
    id,
    inputSchema: emptyObjectSchema,
    label: id,
    outputSchema: emptyObjectSchema,
    retry,
    timeoutMs: 30_000,
    type: "model",
  } as const;
}

const eventBase = {
  callId: null,
  eventKey: "event-1",
  id: ids.event,
  nodeId: null,
  occurredAt: "2026-07-25T09:00:00.000Z",
  runId: ids.run,
  schemaVersion: RUN_EVENT_SCHEMA_VERSION,
  sequence: 1,
  workspaceId: ids.workspace,
} as const;

describe("AI model contracts", () => {
  it("requires the exact API version and rejects provider internals", () => {
    assert.equal(ModelReferenceSchema.safeParse(chatModel).success, true);
    assert.equal(ModelReferenceSchema.safeParse({ ...chatModel, apiVersion: "hermes.ai/v2" }).success, false);
    assert.equal(ModelReferenceSchema.safeParse({ ...chatModel, endpoint: "https://models.example" }).success, false);
    assert.equal(ModelReferenceSchema.safeParse({ ...chatModel, secret: "do-not-accept" }).success, false);
  });

  it("keeps model binding modes mutually exclusive", () => {
    assert.equal(ModelBindingSchema.safeParse({
      apiVersion: AI_API_VERSION,
      capability: "chat",
      mode: "workspaceDefault",
    }).success, true);
    assert.equal(ModelBindingSchema.safeParse({
      apiVersion: AI_API_VERSION,
      capability: "chat",
      mode: "workspaceDefault",
      model: chatModel,
    }).success, false);
    assert.equal(ModelBindingSchema.safeParse({
      allowedModels: [chatModel],
      apiVersion: AI_API_VERSION,
      capability: "chat",
      fallback: { mode: "pinned", model: chatModel },
      mode: "requestOverride",
    }).success, true);
    assert.equal(ModelBindingSchema.safeParse({
      allowedModels: [{ ...chatModel, capability: "embedding" }],
      apiVersion: AI_API_VERSION,
      capability: "chat",
      fallback: { mode: "workspaceDefault" },
      mode: "requestOverride",
    }).success, false);
    assert.equal(ModelBindingSchema.safeParse({
      allowedModels: [chatModel, chatModel],
      apiVersion: AI_API_VERSION,
      capability: "chat",
      fallback: { mode: "workspaceDefault" },
      mode: "requestOverride",
    }).success, false);
  });
});

describe("AI tool contracts", () => {
  const internalTool = {
    allowsArtifact: false,
    description: "Describe an approved dataset.",
    driverType: "internal",
    id: ids.tool,
    idempotency: "notRequired",
    inputSchema: emptyObjectSchema,
    maxResponseBytes: 1_048_576,
    name: "analytics.describe-dataset",
    networkPolicyIds: [],
    outputRedactionPaths: [],
    outputSchema: emptyObjectSchema,
    requiredPermissions: ["workspace.analytics.read"],
    retry,
    schemaVersion: TOOL_DEFINITION_SCHEMA_VERSION,
    sideEffect: "none",
    timeoutMs: 10_000,
    version: "1.0.0",
  } as const;

  it("accepts controlled declarations and rejects endpoint-like fields", () => {
    assert.equal(ToolDefinitionSchema.safeParse(internalTool).success, true);
    assert.equal(ToolDefinitionSchema.safeParse({ ...internalTool, endpoint: "https://example.test" }).success, false);
    assert.equal(ToolDefinitionSchema.safeParse({ ...internalTool, credential: "token" }).success, false);
  });

  it("requires external tools to reference a controlled connection", () => {
    assert.equal(ToolDefinitionSchema.safeParse({
      ...internalTool,
      driverType: "http",
      networkPolicyIds: ["network-policy-1"],
    }).success, false);
    assert.equal(ToolDefinitionSchema.safeParse({
      ...internalTool,
      connectionId: ids.provider,
      driverType: "http",
      networkPolicyIds: ["network-policy-1"],
    }).success, true);
  });
});

describe("Agent graph contracts", () => {
  it("accepts cycles while validating stable node and edge references", () => {
    const cyclicGraph = {
      edges: [
        { id: "edge-a-b", kind: "default", sourceNodeId: "node-a", targetNodeId: "node-b" },
        { id: "edge-b-a", kind: "default", sourceNodeId: "node-b", targetNodeId: "node-a" },
      ],
      entryNodeId: "node-a",
      nodes: [modelNode("node-a"), modelNode("node-b")],
      schemaVersion: AGENT_GRAPH_SCHEMA_VERSION,
      variables: [],
    } as const;
    assert.equal(AgentGraphSchema.safeParse(cyclicGraph).success, true);
    assert.equal(AgentGraphSchema.safeParse({ ...cyclicGraph, entryNodeId: "missing" }).success, false);
    assert.equal(AgentGraphSchema.safeParse({
      ...cyclicGraph,
      edges: [{ ...cyclicGraph.edges[0], targetNodeId: "missing" }],
    }).success, false);
  });

  it("rejects duplicate IDs and unknown graph or node fields", () => {
    const graph = {
      edges: [],
      entryNodeId: "node-a",
      nodes: [modelNode("node-a"), modelNode("node-a")],
      schemaVersion: AGENT_GRAPH_SCHEMA_VERSION,
      variables: [],
    } as const;
    assert.equal(AgentGraphSchema.safeParse(graph).success, false);
    assert.equal(AgentGraphSchema.safeParse({
      ...graph,
      nodes: [{ ...modelNode("node-a"), executableCode: "process.exit()" }],
    }).success, false);
    assert.equal(AgentGraphSchema.safeParse({ ...graph, viewport: { x: 0, y: 0 } }).success, false);
    assert.equal(AgentGraphSchema.safeParse({ ...graph, schemaVersion: "hermes.agent-graph/v2" }).success, false);
  });
});

describe("trusted execution scope", () => {
  it("models an immutable server-owned workspace scope without extensible request fields", () => {
    const scope = {
      actorAccountId: ids.account,
      agentVersionId: ids.agentVersion,
      allowedFilePurposes: ["artifact"],
      budget: { maxCostMicros: 1_000_000, maxDurationMs: 60_000, maxInputTokens: 10_000, maxOutputTokens: 2_000 },
      cancellationRequested: false,
      conversationId: null,
      correlationId: "request-1",
      dataClassification: "internal",
      deadlineAt: "2026-07-25T09:01:00.000Z",
      idempotencyKey: "run-request-1",
      parentRunId: null,
      providerGrants: [{ deploymentId: ids.deployment, grantId: ids.grant, revision: 1 }],
      runId: ids.run,
      schemaVersion: EXECUTION_SCOPE_SCHEMA_VERSION,
      sessionId: ids.session,
      subjectScope: "workspace",
      toolGrants: [{ grantId: ids.grant, toolDefinitionId: ids.tool, version: "1.0.0" }],
      workspaceId: ids.workspace,
    } as const;
    assert.equal(ExecutionScopeSchema.safeParse(scope).success, true);
    assert.equal(ExecutionScopeSchema.safeParse({ ...scope, workspaceHeader: ids.workspace }).success, false);
    assert.equal(ExecutionScopeSchema.safeParse({ ...scope, schemaVersion: "hermes.execution-scope/v2" }).success, false);
  });
});

describe("run event contracts", () => {
  it("accepts exact event payloads and rejects payload drift", () => {
    const started = {
      ...eventBase,
      payload: { agentVersionId: ids.agentVersion, status: "running" },
      type: "run.started",
    } as const;
    assert.equal(RunEventSchema.safeParse(started).success, true);
    assert.equal(RunEventSchema.safeParse({ ...started, payload: { ...started.payload, status: "queued" } }).success, false);
    assert.equal(RunEventSchema.safeParse({ ...started, payload: { ...started.payload, debug: true } }).success, false);
    assert.equal(RunEventSchema.safeParse({ ...started, schemaVersion: "hermes.run-event/v2" }).success, false);
    assert.equal(RunEventSchema.safeParse({ ...started, type: "run.future-event" }).success, false);
  });

  it("validates usage accounting and structured failure events", () => {
    assert.equal(RunEventSchema.safeParse({
      ...eventBase,
      payload: {
        capability: "chat",
        costMicros: 25,
        currency: "usd",
        deploymentId: ids.deployment,
        deploymentRevision: 3,
        inputTokens: 10,
        latencyMs: 400,
        modelId: "chat-primary",
        outputTokens: 5,
        providerId: ids.provider,
        totalTokens: 15,
      },
      type: "usage.recorded",
    }).success, true);
    assert.equal(RunEventSchema.safeParse({
      ...eventBase,
      payload: {
        capability: "chat",
        costMicros: 25,
        currency: "USD",
        deploymentId: ids.deployment,
        deploymentRevision: 3,
        inputTokens: 10,
        latencyMs: 400,
        modelId: "chat-primary",
        outputTokens: 5,
        providerId: ids.provider,
        totalTokens: 99,
      },
      type: "usage.recorded",
    }).success, false);

    const error = {
      category: "providerPolicy.future",
      code: "AI_MODEL_POLICY_BLOCKED_V2",
      correlationId: "request-1",
      publicMessage: "The selected model is unavailable.",
      retryable: false,
      schemaVersion: AI_ERROR_SCHEMA_VERSION,
    } as const;
    assert.equal(RunEventSchema.safeParse({
      ...eventBase,
      payload: { error, status: "failed" },
      type: "run.failed",
    }).success, true);
  });
});

describe("AI error boundary", () => {
  it("keeps codes and categories forward-compatible while rejecting private fields", () => {
    const futureError = {
      category: "providerPolicy.future",
      code: "AI_MODEL_POLICY_BLOCKED_V2",
      correlationId: "request-1",
      publicMessage: "The selected model is unavailable.",
      retryable: false,
      schemaVersion: AI_ERROR_SCHEMA_VERSION,
    } as const;
    assert.equal(AiErrorSchema.safeParse(futureError).success, true);
    assert.equal(AiErrorSchema.safeParse({ ...futureError, code: "MODEL_POLICY_BLOCKED_V2" }).success, false);
    assert.equal(AiErrorSchema.safeParse({ ...futureError, stack: "secret stack" }).success, false);
  });

  it("redacts untrusted internal errors to a stable public fallback", () => {
    const result = redactAiError({
      category: "internal",
      code: "DATABASE_FAILURE",
      correlationId: "request-1",
      publicMessage: "password=minio-secret",
      retryable: false,
      schemaVersion: AI_ERROR_SCHEMA_VERSION,
      secret: "minio-secret",
      stack: "database stack",
    }, "request-1");
    assert.deepEqual(result, {
      category: "internal",
      code: "AI_INTERNAL_ERROR",
      correlationId: "request-1",
      publicMessage: "The AI operation could not be completed.",
      retryable: false,
      schemaVersion: AI_ERROR_SCHEMA_VERSION,
    });
    assert.equal(JSON.stringify(result).includes("minio-secret"), false);
    assert.equal(JSON.stringify(result).includes("database stack"), false);
  });
});
