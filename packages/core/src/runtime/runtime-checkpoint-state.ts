export type RuntimeCheckpointJsonPrimitive = boolean | null | number | string;
export type RuntimeCheckpointJsonArray = readonly RuntimeCheckpointJsonValue[];
export type RuntimeCheckpointJsonObject = Readonly<{
  [key: string]: RuntimeCheckpointJsonValue;
}>;
export type RuntimeCheckpointJsonValue =
  | RuntimeCheckpointJsonArray
  | RuntimeCheckpointJsonObject
  | RuntimeCheckpointJsonPrimitive;

export type RuntimeCheckpointAdapterDescriptor = Readonly<{
  checkpointVersion: string;
  kind: string;
}>;

export type RuntimeCheckpointAdapterStateEnvelope = Readonly<{
  adapter: RuntimeCheckpointAdapterDescriptor;
  state: RuntimeCheckpointJsonValue;
}>;

export type RuntimeCheckpointPendingWrite = Readonly<{
  channel: string;
  index: number;
  taskId: string;
  type: string;
  value: RuntimeCheckpointJsonValue;
}>;

const POSTGRES_INTEGER_MAX = 2_147_483_647;
const POSTGRES_INTEGER_MIN = -2_147_483_648;
const ADAPTER_KIND_PATTERN =
  /^[a-z][a-z0-9-]*(?:[.][a-z][a-z0-9-]*)+$/;
const CHECKPOINT_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9./:_-]*$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/;
const NAMESPACE_PATTERN = /^[A-Za-z0-9._:/|@-]{0,500}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITE_CHANNEL_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._:/-]{0,127}$/;
const WRITE_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WRITE_TYPE_PATTERN = /^[a-z][a-z0-9._+-]{0,31}$/;
const MAX_JSON_DEPTH = 64;

export class RuntimeCheckpointValidationError extends Error {
  constructor() {
    super("Runtime checkpoint value is invalid.");
    this.name = "RuntimeCheckpointValidationError";
  }
}

export function createRuntimeCheckpointAdapterStateEnvelope(input: {
  adapter: unknown;
  state: unknown;
}): RuntimeCheckpointAdapterStateEnvelope {
  if (!isPlainRecord(input)) throw new RuntimeCheckpointValidationError();
  return adapterStateEnvelope({
    adapter: adapterDescriptor(input.adapter),
    state: copyRuntimeCheckpointJsonValue(input.state),
  });
}

export function parseRuntimeCheckpointAdapterStateEnvelope(
  value: unknown,
): RuntimeCheckpointAdapterStateEnvelope {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["adapter", "state"])
  ) {
    throw new RuntimeCheckpointValidationError();
  }
  return adapterStateEnvelope({
    adapter: adapterDescriptor(value.adapter),
    state: copyRuntimeCheckpointJsonValue(value.state),
  });
}

export function createRuntimeCheckpointPendingWrite(input: {
  channel: unknown;
  index: unknown;
  taskId: unknown;
  type: unknown;
  value: unknown;
}): RuntimeCheckpointPendingWrite {
  if (!isPlainRecord(input)) throw new RuntimeCheckpointValidationError();
  return Object.freeze({
    channel: canonicalText(input.channel, 128, WRITE_CHANNEL_PATTERN),
    index: postgresInteger(input.index),
    taskId: canonicalText(input.taskId, 128, WRITE_TASK_ID_PATTERN),
    type: canonicalText(input.type, 32, WRITE_TYPE_PATTERN),
    value: copyRuntimeCheckpointJsonValue(input.value),
  });
}

export function copyRuntimeCheckpointJsonValue(
  value: unknown,
): RuntimeCheckpointJsonValue {
  return cloneJsonValue(value, new WeakSet(), 0);
}

export function normalizeRuntimeCheckpointIdempotencyKey(value: unknown) {
  if (typeof value !== "string") throw new RuntimeCheckpointValidationError();
  const key = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new RuntimeCheckpointValidationError();
  }
  return key;
}

export function normalizeRuntimeCheckpointNamespace(value: unknown) {
  if (typeof value !== "string" || !NAMESPACE_PATTERN.test(value)) {
    throw new RuntimeCheckpointValidationError();
  }
  return value;
}

export function normalizeRuntimeCheckpointAdapterKey(value: unknown) {
  if (typeof value !== "string" || !UUID_PATTERN.test(value)) {
    throw new RuntimeCheckpointValidationError();
  }
  return value.toLowerCase();
}

export function normalizeRuntimeCheckpointStateDigest(value: unknown) {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new RuntimeCheckpointValidationError();
  }
  return value;
}

export function parseRuntimeCheckpointSequence(value: unknown) {
  return positivePostgresInteger(value);
}

export function parseRuntimeCheckpointLeaseGeneration(value: unknown) {
  return positivePostgresInteger(value);
}

function positivePostgresInteger(value: unknown) {
  const sequence = Number(value);
  if (
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    sequence > POSTGRES_INTEGER_MAX
  ) {
    throw new RuntimeCheckpointValidationError();
  }
  return sequence;
}

function adapterStateEnvelope(
  value: RuntimeCheckpointAdapterStateEnvelope,
): RuntimeCheckpointAdapterStateEnvelope {
  return Object.freeze(value);
}

function adapterDescriptor(value: unknown): RuntimeCheckpointAdapterDescriptor {
  if (
    !isPlainRecord(value) ||
    !hasExactKeys(value, ["checkpointVersion", "kind"])
  ) {
    throw new RuntimeCheckpointValidationError();
  }
  return Object.freeze({
    checkpointVersion: canonicalText(
      value.checkpointVersion,
      128,
      CHECKPOINT_VERSION_PATTERN,
    ),
    kind: canonicalText(value.kind, 128, ADAPTER_KIND_PATTERN),
  });
}

function cloneJsonValue(
  value: unknown,
  ancestors: WeakSet<object>,
  depth: number,
): RuntimeCheckpointJsonValue {
  if (depth > MAX_JSON_DEPTH) throw new RuntimeCheckpointValidationError();
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RuntimeCheckpointValidationError();
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) throw new RuntimeCheckpointValidationError();
    ancestors.add(value);
    const clone = value.map((item) =>
      cloneJsonValue(item, ancestors, depth + 1),
    );
    ancestors.delete(value);
    return Object.freeze(clone);
  }
  if (!isPlainRecord(value) || ancestors.has(value)) {
    throw new RuntimeCheckpointValidationError();
  }
  ancestors.add(value);
  const clone: Record<string, RuntimeCheckpointJsonValue> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") throw new RuntimeCheckpointValidationError();
    Object.defineProperty(clone, key, {
      configurable: false,
      enumerable: true,
      value: cloneJsonValue(value[key], ancestors, depth + 1),
      writable: false,
    });
  }
  ancestors.delete(value);
  return Object.freeze(clone);
}

function postgresInteger(value: unknown) {
  const integer = Number(value);
  if (
    !Number.isSafeInteger(integer) ||
    integer < POSTGRES_INTEGER_MIN ||
    integer > POSTGRES_INTEGER_MAX
  ) {
    throw new RuntimeCheckpointValidationError();
  }
  return integer;
}

function canonicalText(value: unknown, maximum: number, pattern: RegExp) {
  if (typeof value !== "string") throw new RuntimeCheckpointValidationError();
  const text = value.trim();
  if (text.length < 1 || text.length > maximum || !pattern.test(text)) {
    throw new RuntimeCheckpointValidationError();
  }
  return text;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const actual = Reflect.ownKeys(value);
  return (
    actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => typeof key === "string" && expected.includes(key))
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
