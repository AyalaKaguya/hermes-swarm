export const RUNTIME_RUN_SCHEMA_VERSION = "hermes.runtime-run/v1" as const;
export const RUNTIME_DISPATCH_SCHEMA_VERSION =
  "hermes.runtime-dispatch/v1" as const;

export type RuntimeRunSchemaVersion = typeof RUNTIME_RUN_SCHEMA_VERSION;
export type RuntimeDispatchSchemaVersion =
  typeof RUNTIME_DISPATCH_SCHEMA_VERSION;
