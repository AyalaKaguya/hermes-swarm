import type {
  AgentDefinition,
  AgentEdge,
  AgentGraph,
  AgentNode,
  ModelBinding,
  ModelReference,
  ToolReference,
  WorkspaceDefaultModel,
  WorkspaceModelOption,
  WorkspaceToolGrant,
} from "@/lib/admin-api/agents";

export const AGENT_EDITOR_STATE_VERSION = 1 as const;

export type AgentEditorPosition = {
  x: number;
  y: number;
};

export type AgentEditorViewport = AgentEditorPosition & {
  zoom: number;
};

/**
 * React Flow state is deliberately stored outside AgentGraph. Agent versions
 * remain portable executable snapshots without viewport or layout concerns.
 */
export type AgentEditorState = {
  positions: Record<string, AgentEditorPosition>;
  version: typeof AGENT_EDITOR_STATE_VERSION;
  viewport: AgentEditorViewport;
};

export type AgentSelection =
  | { id: string; kind: "edge" }
  | { id: string; kind: "node" }
  | null;

export type AgentConnectionResult =
  | { edge: AgentEdge; ok: true }
  | {
      issue: "branchUnavailable" | "endSource" | "missingNode";
      ok: false;
    };

type CreateNodeOptions = {
  id?: string;
  label?: string;
  model?: ModelBinding;
  tool?: ToolReference;
};

const DEFAULT_VIEWPORT: AgentEditorViewport = { x: 0, y: 0, zoom: 1 };

export function createStarterAgentDefinition(
  modelOptions: WorkspaceModelOption[],
  defaults: WorkspaceDefaultModel[],
): AgentDefinition {
  const defaultChatDeployment = defaults.find(
    (item) => item.capability === "chat" && item.workspaceDeploymentId,
  )?.workspaceDeploymentId;
  const pinned =
    modelOptions.find(
      (item) =>
        item.reference.capability === "chat" &&
        item.reference.deploymentId === defaultChatDeployment,
    ) ?? modelOptions.find((item) => item.reference.capability === "chat");
  const model: ModelBinding = pinned
    ? {
        apiVersion: "hermes.ai/v1",
        mode: "pinned",
        model: pinned.reference,
      }
    : {
        apiVersion: "hermes.ai/v1",
        capability: "chat",
        mode: "workspaceDefault",
      };
  const compose = createAgentNode("model", {
    id: "compose",
    label: "Compose response",
    model,
  });
  const done = createAgentNode("end", { id: "done", label: "Complete" });
  const graph: AgentGraph = {
    edges: [
      {
        id: "edge-compose-done",
        kind: "default",
        sourceNodeId: compose.id,
        targetNodeId: done.id,
      },
    ],
    entryNodeId: compose.id,
    nodes: [compose, done],
    schemaVersion: "hermes.agent-graph/v1",
    variables: [],
  };

  return deriveAgentDefinition(graph);
}

export function createAgentNode(
  type: AgentNode["type"],
  options: CreateNodeOptions = {},
): AgentNode {
  const id = options.id ?? runtimeId(type);
  const common = {
    id,
    inputSchema: emptyObjectSchema(),
    label: options.label ?? defaultNodeLabel(type),
    outputSchema: emptyObjectSchema(),
    retry: { backoffMs: 250, maxAttempts: 1, strategy: "fixed" as const },
  };

  if (type === "model") {
    return {
      ...common,
      config: {
        instructions: "",
        model:
          options.model ??
          ({
            apiVersion: "hermes.ai/v1",
            capability: "chat",
            mode: "workspaceDefault",
          } satisfies ModelBinding),
        schemaVersion: "hermes.agent-node.model/v1",
      },
      timeoutMs: 30_000,
      type,
    };
  }

  if (type === "tool") {
    if (!options.tool) {
      throw new Error("A Tool reference is required to create a Tool node");
    }
    return {
      ...common,
      config: {
        inputBindings: {},
        schemaVersion: "hermes.agent-node.tool/v1",
        tool: options.tool,
      },
      timeoutMs: 30_000,
      type,
    };
  }

  if (type === "condition") {
    return {
      ...common,
      config: {
        cases: ["yes", "no"],
        schemaVersion: "hermes.agent-node.condition/v1",
        sourcePath: "/result",
      },
      timeoutMs: 1_000,
      type,
    };
  }

  return {
    ...common,
    config: {
      outputPath: null,
      result: "success",
      schemaVersion: "hermes.agent-node.end/v1",
    },
    timeoutMs: 100,
    type,
  };
}

export function deriveAgentDefinition(graph: AgentGraph): AgentDefinition {
  const models = new Map<string, ModelReference>();
  const tools = new Map<string, ToolReference>();

  for (const node of graph.nodes) {
    if (node.type === "tool") {
      tools.set(toolReferenceKey(node.config.tool), node.config.tool);
      continue;
    }
    if (node.type !== "model") continue;

    const binding = node.config.model;
    if (binding.mode === "pinned") {
      models.set(modelReferenceKey(binding.model), binding.model);
      continue;
    }
    if (binding.mode !== "requestOverride") continue;
    for (const model of binding.allowedModels) {
      models.set(modelReferenceKey(model), model);
    }
    if (binding.fallback.mode === "pinned") {
      models.set(
        modelReferenceKey(binding.fallback.model),
        binding.fallback.model,
      );
    }
  }

  return {
    graph,
    modelReferences: [...models.values()],
    toolReferences: [...tools.values()],
  };
}

export function definitionFingerprint(definition: AgentDefinition) {
  return JSON.stringify({
    graph: definition.graph,
    modelReferences: [...definition.modelReferences].sort((left, right) =>
      modelReferenceKey(left).localeCompare(modelReferenceKey(right)),
    ),
    toolReferences: [...definition.toolReferences].sort((left, right) =>
      toolReferenceKey(left).localeCompare(toolReferenceKey(right)),
    ),
  });
}

export function modelReferenceKey(reference: ModelReference) {
  return [
    reference.providerScope,
    reference.deploymentId,
    reference.modelId,
    reference.capability,
  ].join(":");
}

export function toolReferenceKey(reference: ToolReference) {
  return `${reference.toolDefinitionId}:${reference.version}`;
}

export function bindingSelectValue(binding: ModelBinding) {
  if (binding.mode === "workspaceDefault") {
    return `default:${binding.capability}`;
  }
  if (binding.mode === "pinned") {
    return `pinned:${modelReferenceKey(binding.model)}`;
  }
  return `override:${binding.capability}`;
}

export function modelBindingFromSelectValue(
  value: string,
  modelOptions: WorkspaceModelOption[],
): ModelBinding | null {
  if (value.startsWith("default:")) {
    const capability = value.slice("default:".length) as ModelReference["capability"];
    if (!MODEL_CAPABILITIES.has(capability)) return null;
    return {
      apiVersion: "hermes.ai/v1",
      capability,
      mode: "workspaceDefault",
    };
  }
  if (!value.startsWith("pinned:")) return null;
  const key = value.slice("pinned:".length);
  const option = modelOptions.find(
    (item) => modelReferenceKey(item.reference) === key,
  );
  return option
    ? { apiVersion: "hermes.ai/v1", mode: "pinned", model: option.reference }
    : null;
}

export function isToolGrantAvailable(grant: WorkspaceToolGrant, now = Date.now()) {
  return (
    grant.enabled &&
    grant.configured &&
    (grant.expiresAt === null || Date.parse(grant.expiresAt) > now)
  );
}

export function connectAgentNodes(
  graph: AgentGraph,
  sourceNodeId: string,
  targetNodeId: string,
): AgentConnectionResult {
  const source = graph.nodes.find((node) => node.id === sourceNodeId);
  const target = graph.nodes.find((node) => node.id === targetNodeId);
  if (!source || !target) return { issue: "missingNode", ok: false };
  if (source.type === "end") return { issue: "endSource", ok: false };

  const outgoing = graph.edges.filter(
    (edge) => edge.sourceNodeId === sourceNodeId,
  );
  const base = {
    id: runtimeId("edge"),
    sourceNodeId,
    targetNodeId,
  };

  if (source.type === "condition") {
    const usedCases = new Set(
      outgoing
        .filter((edge) => edge.kind === "condition")
        .map((edge) => edge.case),
    );
    const nextCase = source.config.cases.find((item) => !usedCases.has(item));
    if (nextCase) {
      return {
        edge: { ...base, case: nextCase, kind: "condition" },
        ok: true,
      };
    }
  }

  if (!outgoing.some((edge) => edge.kind === "default")) {
    return { edge: { ...base, kind: "default" }, ok: true };
  }
  if (!outgoing.some((edge) => edge.kind === "error")) {
    return {
      edge: { ...base, errorCodes: [], kind: "error" },
      ok: true,
    };
  }
  return { issue: "branchUnavailable", ok: false };
}

export function removeAgentNode(graph: AgentGraph, nodeId: string): AgentGraph {
  if (graph.nodes.length === 1) return graph;
  const nodes = graph.nodes.filter((node) => node.id !== nodeId);
  if (nodes.length === graph.nodes.length) return graph;
  return {
    ...graph,
    edges: graph.edges.filter(
      (edge) =>
        edge.sourceNodeId !== nodeId && edge.targetNodeId !== nodeId,
    ),
    entryNodeId:
      graph.entryNodeId === nodeId ? (nodes[0]?.id ?? graph.entryNodeId) : graph.entryNodeId,
    nodes,
  };
}

export function replaceAgentNode(graph: AgentGraph, node: AgentNode): AgentGraph {
  if (!graph.nodes.some((item) => item.id === node.id)) return graph;
  return {
    ...graph,
    edges:
      node.type === "condition"
        ? graph.edges.filter(
            (edge) =>
              edge.sourceNodeId !== node.id ||
              edge.kind !== "condition" ||
              node.config.cases.includes(edge.case),
          )
        : graph.edges,
    nodes: graph.nodes.map((item) => (item.id === node.id ? node : item)),
  };
}

export function removeAgentEdge(graph: AgentGraph, edgeId: string): AgentGraph {
  return {
    ...graph,
    edges: graph.edges.filter((edge) => edge.id !== edgeId),
  };
}

export function replaceAgentEdge(graph: AgentGraph, edge: AgentEdge): AgentGraph {
  return {
    ...graph,
    edges: graph.edges.map((item) => (item.id === edge.id ? edge : item)),
  };
}

export function normalizeEditorState(
  graph: AgentGraph,
  candidate?: Partial<AgentEditorState> | null,
): AgentEditorState {
  const positions: Record<string, AgentEditorPosition> = {};
  graph.nodes.forEach((node, index) => {
    const position = candidate?.positions?.[node.id];
    positions[node.id] = isPosition(position)
      ? position
      : defaultPosition(index);
  });
  const viewport = isViewport(candidate?.viewport)
    ? candidate.viewport
    : DEFAULT_VIEWPORT;
  return {
    positions,
    version: AGENT_EDITOR_STATE_VERSION,
    viewport,
  };
}

export function loadAgentEditorState(
  agentId: string,
  graph: AgentGraph,
  storage?: Pick<Storage, "getItem">,
) {
  const resolvedStorage =
    storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!resolvedStorage) return normalizeEditorState(graph);
  try {
    const value = resolvedStorage.getItem(agentEditorStorageKey(agentId));
    if (!value) return normalizeEditorState(graph);
    return normalizeEditorState(
      graph,
      JSON.parse(value) as Partial<AgentEditorState>,
    );
  } catch {
    return normalizeEditorState(graph);
  }
}

export function saveAgentEditorState(
  agentId: string,
  state: AgentEditorState,
  storage?: Pick<Storage, "setItem">,
) {
  const resolvedStorage =
    storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
  if (!resolvedStorage) return false;
  try {
    resolvedStorage.setItem(agentEditorStorageKey(agentId), JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function agentEditorStorageKey(agentId: string) {
  return `hermes.agent-studio.editor.v1:${agentId}`;
}

export function nextNodePosition(state: AgentEditorState, nodeCount: number) {
  const viewport = state.viewport;
  return {
    x: Math.max(24, (160 - viewport.x) / viewport.zoom + (nodeCount % 3) * 36),
    y: Math.max(24, (120 - viewport.y) / viewport.zoom + (nodeCount % 5) * 28),
  };
}

function emptyObjectSchema() {
  return {
    additionalProperties: false as const,
    properties: {},
    required: [],
    type: "object" as const,
  };
}

function defaultNodeLabel(type: AgentNode["type"]) {
  if (type === "model") return "Model";
  if (type === "tool") return "Tool";
  if (type === "condition") return "Condition";
  return "End";
}

function runtimeId(prefix: string) {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${suffix}`;
}

function defaultPosition(index: number): AgentEditorPosition {
  return {
    x: 72 + (index % 3) * 280,
    y: 72 + Math.floor(index / 3) * 180,
  };
}

function isPosition(value: unknown): value is AgentEditorPosition {
  if (!value || typeof value !== "object") return false;
  const position = value as Partial<AgentEditorPosition>;
  return Number.isFinite(position.x) && Number.isFinite(position.y);
}

function isViewport(value: unknown): value is AgentEditorViewport {
  if (!isPosition(value)) return false;
  const viewport = value as Partial<AgentEditorViewport>;
  return (
    Number.isFinite(viewport.zoom) &&
    (viewport.zoom ?? 0) >= 0.1 &&
    (viewport.zoom ?? 0) <= 4
  );
}

const MODEL_CAPABILITIES = new Set<ModelReference["capability"]>([
  "chat",
  "embedding",
  "rerank",
  "speechToText",
  "textToSpeech",
]);
