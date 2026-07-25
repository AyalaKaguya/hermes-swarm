import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import {
  createAgent,
  getAgent,
  getAgentDraft,
  getAgentVersion,
  listAgentVersions,
  listAgents,
  listWorkspaceModelDefaults,
  listWorkspaceModelDeployments,
  listWorkspaceModelProviders,
  listWorkspaceToolGrants,
  publishAgentDraft,
  replaceAgentDraft,
  toWorkspaceModelOptions,
  updateAgent,
  type WorkspaceModelDeployment,
  type WorkspaceModelProvider,
} from "./agents";
import {
  createStarterAgentDefinition,
  definitionFingerprint,
  deriveAgentDefinition,
  loadAgentEditorState,
  saveAgentEditorState,
} from "../../components/agents/agent-editor";

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const AGENT_ID = "11111111-1111-4111-8111-111111111111";
const DRAFT_ID = "22222222-2222-4222-8222-222222222222";
const DEPLOYMENT_ID = "33333333-3333-4333-8333-333333333333";
const PROVIDER_ID = "44444444-4444-4444-8444-444444444444";
const TOOL_ID = "55555555-5555-4555-8555-555555555555";

beforeEach(() => {
  (globalThis as { window?: Partial<Window> }).window = {
    clearTimeout: globalThis.clearTimeout,
    setTimeout: globalThis.setTimeout,
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  (globalThis as { window?: Window }).window = originalWindow;
});

describe("Agent admin API", () => {
  it("uses workspace-derived Agent, Draft, and Version routes", async () => {
    const requests: Array<{ method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push({ method: init?.method ?? "GET", url });
      if (url.endsWith("/draft")) return Response.json(draft());
      if (url.endsWith("/versions/1")) return Response.json(version());
      if (url.endsWith("/versions")) return Response.json([versionSummary()]);
      if (url.endsWith(`/agents/${AGENT_ID}`)) return Response.json(agent());
      return Response.json([agent()]);
    };

    await listAgents("web-session");
    await getAgent("web-session", AGENT_ID);
    await getAgentDraft("web-session", AGENT_ID);
    await listAgentVersions("web-session", AGENT_ID);
    await getAgentVersion("web-session", AGENT_ID, 1);

    assert.deepEqual(requests, [
      { method: "GET", url: "/api/admin/agents" },
      { method: "GET", url: `/api/admin/agents/${AGENT_ID}` },
      { method: "GET", url: `/api/admin/agents/${AGENT_ID}/draft` },
      { method: "GET", url: `/api/admin/agents/${AGENT_ID}/versions` },
      { method: "GET", url: `/api/admin/agents/${AGENT_ID}/versions/1` },
    ]);
    assert.equal(JSON.stringify(requests).includes("workspaceId"), false);
  });

  it("strips editor layout and client workspace fields from all writes", async () => {
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url === "/api/admin/auth/csrf") {
        return Response.json({ csrfToken: "csrf-token" });
      }
      requests.push({
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? "GET",
        url,
      });
      if (url.endsWith("/draft")) return Response.json(draft());
      if (url.endsWith("/versions")) {
        return Response.json(version(), { status: 201 });
      }
      return Response.json(agent(), { status: init?.method === "POST" ? 201 : 200 });
    };

    const definitionWithEditorState = {
      ...definition(),
      graph: {
        ...definition().graph,
        nodes: definition().graph.nodes.map((node) => ({
          ...node,
          position: { x: 120, y: 80 },
          selected: true,
        })),
        viewport: { x: 12, y: 20, zoom: 0.8 },
      },
      editorState: {
        positions: { start: { x: 120, y: 80 } },
        viewport: { x: 12, y: 20, zoom: 0.8 },
      },
      workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    };
    await createAgent("web-session", {
      description: "Answers support questions",
      name: "Support Agent",
      status: "active",
      ...definitionWithEditorState,
    } as never);
    await updateAgent("web-session", AGENT_ID, {
      expectedRevision: 1,
      name: "Updated Agent",
      workspaceId: "forbidden",
    } as never);
    await replaceAgentDraft("web-session", AGENT_ID, {
      expectedRevision: 1,
      ...definitionWithEditorState,
    } as never);
    await publishAgentDraft("web-session", AGENT_ID, {
      expectedRevision: 2,
      workspaceId: "forbidden",
    } as never);

    assert.deepEqual(requests.map(({ body, method, url }) => ({ body, method, url })), [
      {
        body: {
          description: "Answers support questions",
          name: "Support Agent",
          status: "active",
          ...definition(),
        },
        method: "POST",
        url: "/api/admin/agents",
      },
      {
        body: { expectedRevision: 1, name: "Updated Agent" },
        method: "PATCH",
        url: `/api/admin/agents/${AGENT_ID}`,
      },
      {
        body: { expectedRevision: 1, ...definition() },
        method: "PUT",
        url: `/api/admin/agents/${AGENT_ID}/draft`,
      },
      {
        body: { expectedRevision: 2 },
        method: "POST",
        url: `/api/admin/agents/${AGENT_ID}/versions`,
      },
    ]);
    assert.doesNotMatch(JSON.stringify(requests), /editorState|workspaceId|viewport|position/);
  });

  it("loads only credential-free workspace model and Tool inventory", async () => {
    const requests: string[] = [];
    globalThis.fetch = async (input) => {
      const url = String(input);
      requests.push(url);
      if (url.endsWith("/providers")) return Response.json([provider()]);
      if (url.endsWith("/deployments")) return Response.json([deployment()]);
      if (url.endsWith("/defaults")) return Response.json([modelDefault()]);
      return Response.json([toolGrant()]);
    };

    const providers = await listWorkspaceModelProviders("web-session");
    const deployments = await listWorkspaceModelDeployments(
      "web-session",
      PROVIDER_ID,
    );
    await listWorkspaceModelDefaults("web-session");
    await listWorkspaceToolGrants("web-session");
    const options = toWorkspaceModelOptions(providers, deployments);

    assert.deepEqual(requests, [
      "/api/admin/workspace/ai/providers",
      `/api/admin/workspace/ai/providers/${PROVIDER_ID}/deployments`,
      "/api/admin/workspace/ai/defaults",
      "/api/admin/workspace/ai/tools/grants",
    ]);
    assert.deepEqual(options, [
      {
        label: "Primary chat · Workspace provider",
        reference: {
          apiVersion: "hermes.ai/v1",
          capability: "chat",
          deploymentId: DEPLOYMENT_ID,
          modelId: "chat-primary",
          providerScope: "workspace",
        },
      },
    ]);
    assert.doesNotMatch(JSON.stringify(options), /apiKey|secretEnvelope|baseUrl/);
  });

  it("excludes deployments whose workspace provider is disabled", () => {
    const disabledProvider = {
      ...provider(),
      apiVersion: "hermes.ai/v1" as const,
      status: "disabled" as const,
    };
    assert.deepEqual(
      toWorkspaceModelOptions([disabledProvider], [deployment()]),
      [],
    );
  });
});

describe("Agent Studio editor state", () => {
  it("fingerprints Model and Tool references independently of traversal order", () => {
    const workspaceModel = modelReference();
    const platformModel = {
      ...workspaceModel,
      deploymentId: "66666666-6666-4666-8666-666666666666",
      modelId: "chat-platform",
      providerScope: "platform" as const,
    };
    const firstTool = { toolDefinitionId: TOOL_ID, version: "1.0.0" };
    const secondTool = {
      toolDefinitionId: "77777777-7777-4777-8777-777777777777",
      version: "2.0.0",
    };

    assert.equal(
      definitionFingerprint({
        graph: definition().graph,
        modelReferences: [workspaceModel, platformModel],
        toolReferences: [firstTool, secondTool],
      }),
      definitionFingerprint({
        graph: definition().graph,
        modelReferences: [platformModel, workspaceModel],
        toolReferences: [secondTool, firstTool],
      }),
    );
  });

  it("derives exact Model and Tool references without layout fields", () => {
    const graph = {
      ...definition().graph,
      nodes: [
        modelNode(),
        {
          config: {
            inputBindings: {},
            schemaVersion: "hermes.agent-node.tool/v1" as const,
            tool: { toolDefinitionId: TOOL_ID, version: "1.0.0" },
          },
          id: "tool",
          inputSchema: objectSchema(),
          label: "Lookup",
          outputSchema: objectSchema(),
          retry: retry(),
          timeoutMs: 30_000,
          type: "tool" as const,
        },
        endNode(),
      ],
    };

    const derived = deriveAgentDefinition(graph);

    assert.deepEqual(derived.modelReferences, [modelReference()]);
    assert.deepEqual(derived.toolReferences, [
      { toolDefinitionId: TOOL_ID, version: "1.0.0" },
    ]);
    assert.doesNotMatch(
      JSON.stringify(derived),
      /editorState|positions|viewport|"position"/,
    );
  });

  it("keeps React Flow positions and viewport in Agent-scoped local storage", () => {
    const definition = createStarterAgentDefinition(
      [{ label: "Primary", reference: modelReference() }],
      [],
    );
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };
    const editorState = loadAgentEditorState(
      AGENT_ID,
      definition.graph,
      storage,
    );
    editorState.positions.compose = { x: 480, y: 220 };
    editorState.viewport = { x: 12, y: 24, zoom: 0.8 };

    assert.equal(saveAgentEditorState(AGENT_ID, editorState, storage), true);
    assert.deepEqual(
      loadAgentEditorState(AGENT_ID, definition.graph, storage),
      editorState,
    );
    assert.equal(JSON.stringify(definition).includes("viewport"), false);
    assert.equal([...values.keys()].every((key) => key.includes(AGENT_ID)), true);
  });
});

function definition() {
  return {
    graph: {
      edges: [
        {
          id: "start-to-done",
          kind: "default" as const,
          sourceNodeId: "start",
          targetNodeId: "done",
        },
      ],
      entryNodeId: "start",
      nodes: [modelNode(), endNode()],
      schemaVersion: "hermes.agent-graph/v1" as const,
      variables: [],
    },
    modelReferences: [modelReference()],
    toolReferences: [],
  };
}

function modelNode() {
  return {
    config: {
      instructions: "Answer safely.",
      model: {
        apiVersion: "hermes.ai/v1" as const,
        mode: "pinned" as const,
        model: modelReference(),
      },
      schemaVersion: "hermes.agent-node.model/v1" as const,
    },
    id: "start",
    inputSchema: objectSchema(),
    label: "Compose",
    outputSchema: objectSchema(),
    retry: retry(),
    timeoutMs: 30_000,
    type: "model" as const,
  };
}

function endNode() {
  return {
    config: {
      outputPath: null,
      result: "success" as const,
      schemaVersion: "hermes.agent-node.end/v1" as const,
    },
    id: "done",
    inputSchema: objectSchema(),
    label: "Done",
    outputSchema: objectSchema(),
    retry: retry(),
    timeoutMs: 100,
    type: "end" as const,
  };
}

function modelReference() {
  return {
    apiVersion: "hermes.ai/v1" as const,
    capability: "chat" as const,
    deploymentId: DEPLOYMENT_ID,
    modelId: "chat-primary",
    providerScope: "workspace" as const,
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

function retry() {
  return { backoffMs: 100, maxAttempts: 1, strategy: "fixed" as const };
}

function agent() {
  return {
    apiVersion: "hermes.ai/v1",
    createdAt: "2026-07-25T10:00:00.000Z",
    description: "Answers support questions",
    id: AGENT_ID,
    latestVersion: 1,
    name: "Support Agent",
    revision: 1,
    status: "active",
    updatedAt: "2026-07-25T10:00:00.000Z",
  };
}

function draft() {
  return {
    agentId: AGENT_ID,
    apiVersion: "hermes.ai/v1",
    createdAt: "2026-07-25T10:00:00.000Z",
    revision: 1,
    updatedAt: "2026-07-25T10:00:00.000Z",
    ...definition(),
  };
}

function versionSummary() {
  return {
    agentId: AGENT_ID,
    apiVersion: "hermes.ai/v1",
    contentDigest: "a".repeat(64),
    draftRevision: 1,
    id: DRAFT_ID,
    publishedAt: "2026-07-25T10:00:00.000Z",
    version: 1,
  };
}

function version() {
  return { ...versionSummary(), ...definition() };
}

function provider(): WorkspaceModelProvider {
  return {
    apiVersion: "hermes.ai/v1",
    baseUrl: "https://models.example.com/v1",
    createdAt: "2026-07-25T10:00:00.000Z",
    driver: "openai-compatible",
    id: PROVIDER_ID,
    name: "Workspace provider",
    revision: 1,
    secret: {
      configured: true,
      id: "66666666-6666-4666-8666-666666666666",
      mask: "••••••••",
      revision: 1,
      updatedAt: "2026-07-25T10:00:00.000Z",
    },
    status: "enabled",
    updatedAt: "2026-07-25T10:00:00.000Z",
    workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
}

function deployment(): WorkspaceModelDeployment {
  return {
    apiVersion: "hermes.ai/v1",
    capability: "chat",
    createdAt: "2026-07-25T10:00:00.000Z",
    id: DEPLOYMENT_ID,
    modelId: "chat-primary",
    name: "Primary chat",
    providerId: PROVIDER_ID,
    revision: 1,
    status: "enabled",
    updatedAt: "2026-07-25T10:00:00.000Z",
    workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
}

function modelDefault() {
  return {
    apiVersion: "hermes.ai/v1",
    capability: "chat",
    createdAt: "2026-07-25T10:00:00.000Z",
    id: "77777777-7777-4777-8777-777777777777",
    platformDeploymentId: null,
    updatedAt: "2026-07-25T10:00:00.000Z",
    workspaceDeploymentId: DEPLOYMENT_ID,
    workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
}

function toolGrant() {
  return {
    apiVersion: "hermes.ai/v1",
    configured: true,
    connectionId: null,
    createdAt: "2026-07-25T10:00:00.000Z",
    enabled: true,
    expiresAt: null,
    id: "88888888-8888-4888-8888-888888888888",
    revision: 1,
    toolDefinitionId: TOOL_ID,
    toolVersion: "1.0.0",
    updatedAt: "2026-07-25T10:00:00.000Z",
    workspaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  };
}
