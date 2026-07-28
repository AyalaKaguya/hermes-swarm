import type {
  RunHandler,
  RunHandlerContext,
  RunOutcome,
  RuntimeRunKind,
} from "./run-handler.js";

export const RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES = Object.freeze({
  duplicateKind: "RUNTIME_RUN_HANDLER_DUPLICATE_KIND",
  invalidHandler: "RUNTIME_RUN_HANDLER_INVALID",
  unknownKind: "RUNTIME_RUN_HANDLER_UNKNOWN_KIND",
} as const);

export type RuntimeRunHandlerRegistryErrorCode =
  (typeof RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES)[keyof typeof RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES];

export class RuntimeRunHandlerRegistryError extends Error {
  constructor(readonly code: RuntimeRunHandlerRegistryErrorCode) {
    super(messageFor(code));
    this.name = "RuntimeRunHandlerRegistryError";
  }
}

/**
 * Immutable handler lookup keyed only by a persisted Run kind. Queue payloads
 * deliberately do not participate in handler or Workspace selection.
 */
export class RuntimeRunHandlerRegistry {
  private readonly handlersByKind: ReadonlyMap<RuntimeRunKind, RunHandler>;
  private readonly orderedKinds: readonly RuntimeRunKind[];

  constructor(handlers: Iterable<RunHandler>) {
    const candidates = [...handlers].map(readHandler);
    candidates.sort((left, right) => left.kind.localeCompare(right.kind));

    const byKind = new Map<RuntimeRunKind, RunHandler>();
    for (const candidate of candidates) {
      if (byKind.has(candidate.kind)) {
        throw registryError("duplicateKind");
      }
      byKind.set(candidate.kind, candidate.handler);
    }
    this.handlersByKind = byKind;
    this.orderedKinds = Object.freeze([...byKind.keys()]);
  }

  kinds(): readonly RuntimeRunKind[] {
    return this.orderedKinds;
  }

  resolve(kind: string): RunHandler {
    const handler = this.handlersByKind.get(kind as RuntimeRunKind);
    if (!handler) throw registryError("unknownKind");
    return handler;
  }

  execute(
    kind: string,
    context: RunHandlerContext,
  ): Promise<RunOutcome> {
    return this.resolve(kind).execute(context);
  }
}

export function isRuntimeRunKind(value: unknown): value is RuntimeRunKind {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value)
  );
}

function readHandler(handler: RunHandler) {
  try {
    if (
      !handler ||
      !isRuntimeRunKind(handler.kind) ||
      typeof handler.execute !== "function"
    ) {
      throw registryError("invalidHandler");
    }
    return { handler, kind: handler.kind } as const;
  } catch (error) {
    if (error instanceof RuntimeRunHandlerRegistryError) throw error;
    throw registryError("invalidHandler");
  }
}

function registryError(
  key: keyof typeof RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES,
) {
  return new RuntimeRunHandlerRegistryError(
    RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES[key],
  );
}

function messageFor(code: RuntimeRunHandlerRegistryErrorCode) {
  switch (code) {
    case RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES.duplicateKind:
      return "Runtime run handler kind is already registered.";
    case RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES.invalidHandler:
      return "Runtime run handler is invalid.";
    case RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES.unknownKind:
      return "Runtime run handler kind is not registered.";
  }
}
