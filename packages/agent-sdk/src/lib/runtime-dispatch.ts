import {
  RUNTIME_DISPATCH_SCHEMA_VERSION,
  type RuntimeDispatchSchemaVersion,
} from "./versions.js";

export const RUNTIME_DISPATCH_ENVELOPE_VALIDATION_ERROR_CODE =
  "RUNTIME_DISPATCH_ENVELOPE_INVALID" as const;

export type RuntimeDispatchEnvelope = Readonly<{
  schemaVersion: RuntimeDispatchSchemaVersion;
  dispatchId: string;
  runId: string;
}>;

export type CreateRuntimeDispatchEnvelopeInput = Readonly<{
  dispatchId: string;
  runId: string;
}>;

/** Stable, non-reflective error for untrusted queue payload validation. */
export class RuntimeDispatchEnvelopeValidationError extends Error {
  readonly code = RUNTIME_DISPATCH_ENVELOPE_VALIDATION_ERROR_CODE;

  constructor() {
    super("Runtime dispatch envelope is invalid.");
    this.name = "RuntimeDispatchEnvelopeValidationError";
  }
}

/**
 * Creates the only payload shape allowed onto the runtime queue. Workspace,
 * authorization, subject and secret material must be reloaded from storage.
 */
export function createRuntimeDispatchEnvelope(
  input: CreateRuntimeDispatchEnvelopeInput,
): RuntimeDispatchEnvelope {
  return parseCreateInput(input);
}

/** Parses an untrusted queue payload without preserving any input properties. */
export function parseRuntimeDispatchEnvelope(
  value: unknown,
): RuntimeDispatchEnvelope {
  try {
    if (!hasExactKeys(value, ["schemaVersion", "dispatchId", "runId"])) {
      throw invalidEnvelope();
    }
    if (
      value.schemaVersion !== RUNTIME_DISPATCH_SCHEMA_VERSION ||
      !isUuid(value.dispatchId) ||
      !isUuid(value.runId)
    ) {
      throw invalidEnvelope();
    }
    return freezeEnvelope(value.dispatchId, value.runId);
  } catch (error) {
    if (error instanceof RuntimeDispatchEnvelopeValidationError) throw error;
    throw invalidEnvelope();
  }
}

function parseCreateInput(value: unknown): RuntimeDispatchEnvelope {
  try {
    if (!hasExactKeys(value, ["dispatchId", "runId"])) {
      throw invalidEnvelope();
    }
    if (!isUuid(value.dispatchId) || !isUuid(value.runId)) {
      throw invalidEnvelope();
    }
    return freezeEnvelope(value.dispatchId, value.runId);
  } catch (error) {
    if (error instanceof RuntimeDispatchEnvelopeValidationError) throw error;
    throw invalidEnvelope();
  }
}

function freezeEnvelope(dispatchId: string, runId: string) {
  return Object.freeze({
    schemaVersion: RUNTIME_DISPATCH_SCHEMA_VERSION,
    dispatchId,
    runId,
  });
}

function hasExactKeys<T extends readonly string[]>(
  value: unknown,
  expectedKeys: T,
): value is Record<T[number], unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const actualKeys = Reflect.ownKeys(value);
  return (
    actualKeys.length === expectedKeys.length &&
    expectedKeys.every((key) => actualKeys.includes(key))
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function invalidEnvelope() {
  return new RuntimeDispatchEnvelopeValidationError();
}
