export const RUNTIME_RUN_SCHEMA_VERSION = "hermes.runtime-run/v1" as const;
export const RUNTIME_DISPATCH_SCHEMA_VERSION =
  "hermes.runtime-dispatch/v1" as const;
export const GRAPH_EXECUTION_SCHEMA_VERSION =
  "hermes.graph-execution/v1" as const;
export const GRAPH_CHECKPOINT_SCHEMA_VERSION =
  "hermes.graph-checkpoint/v1" as const;
export const GRAPH_CHECKPOINT_PENDING_WRITES_SCHEMA_VERSION =
  "hermes.graph-checkpoint-pending-writes/v1" as const;
export const GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION =
  "hermes.graph-execution-outcome/v1" as const;

export type RuntimeRunSchemaVersion = typeof RUNTIME_RUN_SCHEMA_VERSION;
export type RuntimeDispatchSchemaVersion =
  typeof RUNTIME_DISPATCH_SCHEMA_VERSION;
export type GraphExecutionSchemaVersion =
  typeof GRAPH_EXECUTION_SCHEMA_VERSION;
export type GraphCheckpointSchemaVersion =
  typeof GRAPH_CHECKPOINT_SCHEMA_VERSION;
export type GraphCheckpointPendingWritesSchemaVersion =
  typeof GRAPH_CHECKPOINT_PENDING_WRITES_SCHEMA_VERSION;
export type GraphExecutionOutcomeSchemaVersion =
  typeof GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION;
