import { z } from "zod";
import { JsonValueSchema } from "../models.js";
import {
  AiObjectJsonSchema,
  JsonPointerSchema,
  RuntimeIdentifierSchema,
  RuntimeRetryPolicySchema,
} from "./common.js";
import { ModelBindingSchema } from "./model-reference.js";
import { ToolReferenceSchema } from "./tool-definition.js";
import { AgentGraphSchemaVersionSchema } from "./versions.js";

const nodeBase = {
  id: RuntimeIdentifierSchema,
  inputSchema: AiObjectJsonSchema,
  label: z.string().trim().min(1).max(200),
  outputSchema: AiObjectJsonSchema,
  retry: RuntimeRetryPolicySchema,
  timeoutMs: z.number().int().min(100).max(300_000),
};

const ModelNodeSchema = z.strictObject({
  ...nodeBase,
  config: z.strictObject({
    instructions: z.string().max(100_000),
    maxOutputTokens: z.number().int().min(1).max(1_000_000).optional(),
    model: ModelBindingSchema,
    schemaVersion: z.literal("hermes.agent-node.model/v1"),
    temperature: z.number().min(0).max(2).optional(),
  }),
  type: z.literal("model"),
});

const ToolNodeSchema = z.strictObject({
  ...nodeBase,
  config: z.strictObject({
    inputBindings: z.record(z.string().min(1), JsonPointerSchema),
    schemaVersion: z.literal("hermes.agent-node.tool/v1"),
    tool: ToolReferenceSchema,
  }),
  type: z.literal("tool"),
});

const ConditionNodeSchema = z.strictObject({
  ...nodeBase,
  config: z.strictObject({
    cases: z.array(RuntimeIdentifierSchema).min(1).max(50),
    schemaVersion: z.literal("hermes.agent-node.condition/v1"),
    sourcePath: JsonPointerSchema,
  }).superRefine((config, context) => {
    if (new Set(config.cases).size !== config.cases.length) {
      context.addIssue({ code: "custom", message: "Condition case names must be unique", path: ["cases"] });
    }
  }),
  type: z.literal("condition"),
});

const EndNodeSchema = z.strictObject({
  ...nodeBase,
  config: z.strictObject({
    outputPath: JsonPointerSchema.nullable(),
    result: z.enum(["failure", "success"]),
    schemaVersion: z.literal("hermes.agent-node.end/v1"),
  }),
  type: z.literal("end"),
});

export const AgentNodeSchema = z.discriminatedUnion("type", [
  ModelNodeSchema,
  ToolNodeSchema,
  ConditionNodeSchema,
  EndNodeSchema,
]);

const edgeBase = {
  id: RuntimeIdentifierSchema,
  sourceNodeId: RuntimeIdentifierSchema,
  targetNodeId: RuntimeIdentifierSchema,
};

export const AgentEdgeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ ...edgeBase, kind: z.literal("default") }),
  z.strictObject({ ...edgeBase, case: RuntimeIdentifierSchema, kind: z.literal("condition") }),
  z.strictObject({ ...edgeBase, errorCodes: z.array(RuntimeIdentifierSchema).max(50), kind: z.literal("error") }),
]);

export const AgentVariableSchema = z.strictObject({
  defaultValue: JsonValueSchema.optional(),
  description: z.string().max(1_000).optional(),
  name: RuntimeIdentifierSchema,
  required: z.boolean(),
  type: z.enum(["boolean", "number", "object", "string"]),
});

export const AgentGraphSchema = z.strictObject({
  edges: z.array(AgentEdgeSchema).max(2_000),
  entryNodeId: RuntimeIdentifierSchema,
  nodes: z.array(AgentNodeSchema).min(1).max(1_000),
  schemaVersion: AgentGraphSchemaVersionSchema,
  variables: z.array(AgentVariableSchema).max(200),
}).superRefine((graph, context) => {
  const nodes = new Map<string, z.infer<typeof AgentNodeSchema>>();
  for (const [index, node] of graph.nodes.entries()) {
    if (nodes.has(node.id)) {
      context.addIssue({ code: "custom", message: "Node IDs must be unique", path: ["nodes", index, "id"] });
    } else {
      nodes.set(node.id, node);
    }
  }

  if (!nodes.has(graph.entryNodeId)) {
    context.addIssue({ code: "custom", message: "Entry node must reference an existing node", path: ["entryNodeId"] });
  }

  const edgeIds = new Set<string>();
  const branchKeys = new Set<string>();
  for (const [index, edge] of graph.edges.entries()) {
    if (edgeIds.has(edge.id)) {
      context.addIssue({ code: "custom", message: "Edge IDs must be unique", path: ["edges", index, "id"] });
    }
    edgeIds.add(edge.id);

    const source = nodes.get(edge.sourceNodeId);
    if (!source) {
      context.addIssue({ code: "custom", message: "Edge source must reference an existing node", path: ["edges", index, "sourceNodeId"] });
    }
    if (!nodes.has(edge.targetNodeId)) {
      context.addIssue({ code: "custom", message: "Edge target must reference an existing node", path: ["edges", index, "targetNodeId"] });
    }
    if (source?.type === "end") {
      context.addIssue({ code: "custom", message: "End nodes cannot have outgoing edges", path: ["edges", index, "sourceNodeId"] });
    }
    if (edge.kind === "condition") {
      if (source?.type !== "condition") {
        context.addIssue({ code: "custom", message: "Conditional edges must originate from a condition node", path: ["edges", index, "kind"] });
      } else if (!source.config.cases.includes(edge.case)) {
        context.addIssue({ code: "custom", message: "Conditional edge case is not declared by its source node", path: ["edges", index, "case"] });
      }
    }

    const branch = edge.kind === "condition" ? `${edge.sourceNodeId}:condition:${edge.case}` : `${edge.sourceNodeId}:${edge.kind}`;
    if (branchKeys.has(branch)) {
      context.addIssue({ code: "custom", message: "A node cannot declare the same outgoing branch more than once", path: ["edges", index] });
    }
    branchKeys.add(branch);
  }

  const variableNames = new Set<string>();
  for (const [index, variable] of graph.variables.entries()) {
    if (variableNames.has(variable.name)) {
      context.addIssue({ code: "custom", message: "Variable names must be unique", path: ["variables", index, "name"] });
    }
    variableNames.add(variable.name);
  }
});

export type AgentNode = z.infer<typeof AgentNodeSchema>;
export type AgentEdge = z.infer<typeof AgentEdgeSchema>;
export type AgentVariable = z.infer<typeof AgentVariableSchema>;
export type AgentGraph = z.infer<typeof AgentGraphSchema>;
