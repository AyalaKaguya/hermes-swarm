import type {
  Agent,
  AgentDefinition,
  AgentDraft,
  AgentEdge,
  AgentNode,
  AgentVersion,
  AgentVersionSummary,
  CreateAgentRequest,
  ModelBinding,
  ModelReference,
  PublishAgentDraftRequest,
  ReplaceAgentDraftRequest,
  UpdateAgentRequest,
  WorkspaceDefaultModel,
  WorkspaceModelDeployment,
  WorkspaceModelProvider,
  WorkspaceToolGrant,
  ToolReference,
} from "@hermes-swarm/api-contracts/ai";
import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import { fetchAdmin } from "./client";

export type {
  Agent,
  AgentDefinition,
  AgentDraft,
  AgentGraph,
  AgentNode,
  AgentEdge,
  AgentStatus,
  AgentVersion,
  AgentVersionSummary,
  CreateAgentRequest,
  ModelBinding,
  ModelCapability,
  ModelReference,
  PublishAgentDraftRequest,
  ReplaceAgentDraftRequest,
  ToolReference,
  UpdateAgentRequest,
  WorkspaceDefaultModel,
  WorkspaceModelDeployment,
  WorkspaceModelProvider,
  WorkspaceToolGrant,
} from "@hermes-swarm/api-contracts/ai";

export function listAgents(
  _session: AuthenticatedAdminSessionMarker,
): Promise<Agent[]> {
  return fetchAdmin("/agents");
}

export function getAgent(
  _session: AuthenticatedAdminSessionMarker,
  agentId: string,
): Promise<Agent> {
  return fetchAdmin(`/agents/${encodeURIComponent(agentId)}`);
}

export function createAgent(
  _session: AuthenticatedAdminSessionMarker,
  payload: CreateAgentRequest,
): Promise<Agent> {
  return fetchAdmin("/agents", {
    body: {
      description: payload.description,
      name: payload.name,
      status: payload.status,
      ...definitionBody(payload),
    },
    method: "POST",
  });
}

export function updateAgent(
  _session: AuthenticatedAdminSessionMarker,
  agentId: string,
  payload: UpdateAgentRequest,
): Promise<Agent> {
  return fetchAdmin(`/agents/${encodeURIComponent(agentId)}`, {
    body: {
      expectedRevision: payload.expectedRevision,
      ...(payload.description === undefined
        ? {}
        : { description: payload.description }),
      ...(payload.name === undefined ? {} : { name: payload.name }),
      ...(payload.status === undefined ? {} : { status: payload.status }),
    },
    method: "PATCH",
  });
}

export function getAgentDraft(
  _session: AuthenticatedAdminSessionMarker,
  agentId: string,
): Promise<AgentDraft> {
  return fetchAdmin(`/agents/${encodeURIComponent(agentId)}/draft`);
}

export function replaceAgentDraft(
  _session: AuthenticatedAdminSessionMarker,
  agentId: string,
  payload: ReplaceAgentDraftRequest,
): Promise<AgentDraft> {
  return fetchAdmin(`/agents/${encodeURIComponent(agentId)}/draft`, {
    body: {
      expectedRevision: payload.expectedRevision,
      ...definitionBody(payload),
    },
    method: "PUT",
  });
}

export function listAgentVersions(
  _session: AuthenticatedAdminSessionMarker,
  agentId: string,
): Promise<AgentVersionSummary[]> {
  return fetchAdmin(`/agents/${encodeURIComponent(agentId)}/versions`);
}

export function getAgentVersion(
  _session: AuthenticatedAdminSessionMarker,
  agentId: string,
  version: number,
): Promise<AgentVersion> {
  return fetchAdmin(
    `/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(String(version))}`,
  );
}

export function publishAgentDraft(
  _session: AuthenticatedAdminSessionMarker,
  agentId: string,
  payload: PublishAgentDraftRequest,
): Promise<AgentVersion> {
  return fetchAdmin(`/agents/${encodeURIComponent(agentId)}/versions`, {
    body: { expectedRevision: payload.expectedRevision },
    method: "POST",
  });
}

export function listWorkspaceModelProviders(
  _session: AuthenticatedAdminSessionMarker,
): Promise<WorkspaceModelProvider[]> {
  return fetchAdmin("/workspace/ai/providers");
}

export function listWorkspaceModelDeployments(
  _session: AuthenticatedAdminSessionMarker,
  providerId: string,
): Promise<WorkspaceModelDeployment[]> {
  return fetchAdmin(
    `/workspace/ai/providers/${encodeURIComponent(providerId)}/deployments`,
  );
}

export function listWorkspaceModelDefaults(
  _session: AuthenticatedAdminSessionMarker,
): Promise<WorkspaceDefaultModel[]> {
  return fetchAdmin("/workspace/ai/defaults");
}

export function listWorkspaceToolGrants(
  _session: AuthenticatedAdminSessionMarker,
): Promise<WorkspaceToolGrant[]> {
  return fetchAdmin("/workspace/ai/tools/grants");
}

export type WorkspaceModelOption = {
  label: string;
  reference: ModelReference;
};

export function toWorkspaceModelOptions(
  providers: WorkspaceModelProvider[],
  deployments: WorkspaceModelDeployment[],
): WorkspaceModelOption[] {
  const providerNames = new Map(
    providers
      .filter((provider) => provider.status === "enabled")
      .map((provider) => [provider.id, provider.name]),
  );
  return deployments
    .filter(
      (deployment) =>
        deployment.status === "enabled" &&
        providerNames.has(deployment.providerId),
    )
    .map((deployment) => ({
      label: `${deployment.name} · ${providerNames.get(deployment.providerId) ?? deployment.modelId}`,
      reference: {
        apiVersion: "hermes.ai/v1" as const,
        capability: deployment.capability,
        deploymentId: deployment.id,
        modelId: deployment.modelId,
        providerScope: "workspace" as const,
      },
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
}

function definitionBody(definition: AgentDefinition): AgentDefinition {
  const graph = definition.graph;
  return {
    graph: {
      edges: graph.edges.map(edgeBody),
      entryNodeId: graph.entryNodeId,
      nodes: graph.nodes.map(nodeBody),
      schemaVersion: graph.schemaVersion,
      variables: graph.variables.map((variable) => ({
        ...(variable.defaultValue === undefined
          ? {}
          : { defaultValue: variable.defaultValue }),
        ...(variable.description === undefined
          ? {}
          : { description: variable.description }),
        name: variable.name,
        required: variable.required,
        type: variable.type,
      })),
    },
    modelReferences: definition.modelReferences.map(modelReferenceBody),
    toolReferences: definition.toolReferences.map(toolReferenceBody),
  };
}

function nodeBody(node: AgentNode): AgentNode {
  const common = {
    id: node.id,
    inputSchema: objectSchemaBody(node.inputSchema),
    label: node.label,
    outputSchema: objectSchemaBody(node.outputSchema),
    retry: {
      backoffMs: node.retry.backoffMs,
      maxAttempts: node.retry.maxAttempts,
      strategy: node.retry.strategy,
    },
    timeoutMs: node.timeoutMs,
  };
  if (node.type === "model") {
    return {
      ...common,
      config: {
        instructions: node.config.instructions,
        ...(node.config.maxOutputTokens === undefined
          ? {}
          : { maxOutputTokens: node.config.maxOutputTokens }),
        model: modelBindingBody(node.config.model),
        schemaVersion: node.config.schemaVersion,
        ...(node.config.temperature === undefined
          ? {}
          : { temperature: node.config.temperature }),
      },
      type: node.type,
    };
  }
  if (node.type === "tool") {
    return {
      ...common,
      config: {
        inputBindings: { ...node.config.inputBindings },
        schemaVersion: node.config.schemaVersion,
        tool: toolReferenceBody(node.config.tool),
      },
      type: node.type,
    };
  }
  if (node.type === "condition") {
    return {
      ...common,
      config: {
        cases: [...node.config.cases],
        schemaVersion: node.config.schemaVersion,
        sourcePath: node.config.sourcePath,
      },
      type: node.type,
    };
  }
  return {
    ...common,
    config: {
      outputPath: node.config.outputPath,
      result: node.config.result,
      schemaVersion: node.config.schemaVersion,
    },
    type: node.type,
  };
}

function edgeBody(edge: AgentEdge): AgentEdge {
  const common = {
    id: edge.id,
    sourceNodeId: edge.sourceNodeId,
    targetNodeId: edge.targetNodeId,
  };
  if (edge.kind === "condition") {
    return { ...common, case: edge.case, kind: edge.kind };
  }
  if (edge.kind === "error") {
    return { ...common, errorCodes: [...edge.errorCodes], kind: edge.kind };
  }
  return { ...common, kind: edge.kind };
}

function objectSchemaBody(schema: AgentNode["inputSchema"]) {
  return {
    additionalProperties: schema.additionalProperties,
    properties: { ...schema.properties },
    required: [...schema.required],
    type: schema.type,
  };
}

function modelBindingBody(binding: ModelBinding): ModelBinding {
  if (binding.mode === "workspaceDefault") {
    return {
      apiVersion: binding.apiVersion,
      capability: binding.capability,
      mode: binding.mode,
    };
  }
  if (binding.mode === "pinned") {
    return {
      apiVersion: binding.apiVersion,
      mode: binding.mode,
      model: modelReferenceBody(binding.model),
    };
  }
  return {
    allowedModels: binding.allowedModels.map(modelReferenceBody),
    apiVersion: binding.apiVersion,
    capability: binding.capability,
    fallback:
      binding.fallback.mode === "pinned"
        ? {
            mode: binding.fallback.mode,
            model: modelReferenceBody(binding.fallback.model),
          }
        : { mode: binding.fallback.mode },
    mode: binding.mode,
  };
}

function modelReferenceBody(reference: ModelReference): ModelReference {
  return {
    apiVersion: reference.apiVersion,
    capability: reference.capability,
    deploymentId: reference.deploymentId,
    modelId: reference.modelId,
    providerScope: reference.providerScope,
  };
}

function toolReferenceBody(reference: ToolReference): ToolReference {
  return {
    toolDefinitionId: reference.toolDefinitionId,
    version: reference.version,
  };
}
