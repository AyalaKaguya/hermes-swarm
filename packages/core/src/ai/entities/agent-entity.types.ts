export type AgentStatus = "active" | "archived";
export type AgentApiVersion = "hermes.ai/v1";

/** JSON shapes are validated by @hermes-swarm/api-contracts before storage. */
export type AgentGraphData = {
  edges: unknown[];
  entryNodeId: string;
  nodes: unknown[];
  schemaVersion: "hermes.agent-graph/v1";
  variables: unknown[];
};

export type AgentModelReferenceData = {
  apiVersion: "hermes.ai/v1";
  capability: string;
  deploymentId: string;
  modelId: string;
  providerScope: "platform" | "workspace";
};

export type AgentToolReferenceData = {
  toolDefinitionId: string;
  version: string;
};
