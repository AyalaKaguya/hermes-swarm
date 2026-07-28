import { z } from "zod";

export const AI_API_VERSION = "hermes.ai/v1" as const;
export const AGENT_GRAPH_SCHEMA_VERSION = "hermes.agent-graph/v1" as const;
export const TOOL_DEFINITION_SCHEMA_VERSION = "hermes.tool-definition/v1" as const;
export const EXECUTION_SCOPE_SCHEMA_VERSION = "hermes.execution-scope/v1" as const;
export const RUN_EVENT_SCHEMA_VERSION = "hermes.run-event/v1" as const;
export const AI_ERROR_SCHEMA_VERSION = "hermes.ai-error/v1" as const;

export const AiApiVersionSchema = z.literal(AI_API_VERSION);
export const AgentGraphSchemaVersionSchema = z.literal(AGENT_GRAPH_SCHEMA_VERSION);
export const ToolDefinitionSchemaVersionSchema = z.literal(TOOL_DEFINITION_SCHEMA_VERSION);
export const ExecutionScopeSchemaVersionSchema = z.literal(EXECUTION_SCOPE_SCHEMA_VERSION);
export const RunEventSchemaVersionSchema = z.literal(RUN_EVENT_SCHEMA_VERSION);
export const AiErrorSchemaVersionSchema = z.literal(AI_ERROR_SCHEMA_VERSION);
