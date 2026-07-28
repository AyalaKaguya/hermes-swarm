import type {
  RunFailure,
  RunLease,
  RuntimeRunKind,
} from "./run-handler.js";
import {
  GRAPH_CHECKPOINT_PENDING_WRITES_SCHEMA_VERSION,
  GRAPH_CHECKPOINT_SCHEMA_VERSION,
  GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
  GRAPH_EXECUTION_SCHEMA_VERSION,
  type GraphCheckpointPendingWritesSchemaVersion,
  type GraphCheckpointSchemaVersion,
  type GraphExecutionOutcomeSchemaVersion,
  type GraphExecutionSchemaVersion,
} from "./versions.js";

const MAX_CHECKPOINT_SEQUENCE = 2_147_483_647;
const NAMESPACE_PATTERN = /^[A-Za-z0-9._:/|@-]{0,500}$/;
const WRITE_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const WRITE_CHANNEL_PATTERN = /^[A-Za-z0-9_][A-Za-z0-9._:/-]{0,127}$/;
const WRITE_TYPE_PATTERN = /^[a-z][a-z0-9._+-]{0,31}$/;
const MAX_JSON_DEPTH = 64;

export type HermesJsonPrimitive = boolean | null | number | string;
export type HermesJsonObject = Readonly<{
  [key: string]: HermesJsonValue;
}>;
export type HermesJsonValue =
  | HermesJsonPrimitive
  | HermesJsonObject
  | readonly HermesJsonValue[];

export type GraphCheckpointSelector = Readonly<{
  namespace: string;
  adapterCheckpointKey?: string;
}>;

/**
 * Worker-owned, engine-neutral input. It is built only after the Worker has
 * reconstructed trusted Run state; it is never a queue payload.
 */
export type GraphExecutionEnvelope = Readonly<{
  schemaVersion: GraphExecutionSchemaVersion;
  lease: RunLease;
  checkpoint: GraphCheckpointSelector;
  graphDefinition: HermesJsonValue;
  input: HermesJsonValue;
  resumeInput?: HermesJsonValue;
}>;

export type CreateGraphExecutionEnvelopeInput = Readonly<{
  lease: RunLease;
  checkpoint: GraphCheckpointSelector;
  graphDefinition: HermesJsonValue;
  input: HermesJsonValue;
  resumeInput?: HermesJsonValue;
}>;

/** Identifies an engine and the opaque checkpoint state format it understands. */
export type GraphExecutionAdapterDescriptor = Readonly<{
  kind: RuntimeRunKind;
  checkpointVersion: string;
}>;

/**
 * Stable persisted checkpoint shape. Engine state remains an opaque JSON value
 * and no engine-specific table or row type crosses this boundary.
 */
export type GraphCheckpointEnvelope = Readonly<{
  schemaVersion: GraphCheckpointSchemaVersion;
  checkpointId: string;
  sequence: number;
  runId: string;
  workspaceId: string;
  namespace: string;
  adapterCheckpointKey: string;
  parentCheckpointKey: string | null;
  lineage: readonly string[];
  adapter: GraphExecutionAdapterDescriptor;
  state: HermesJsonValue;
}>;

export type CreateGraphCheckpointEnvelopeInput = Readonly<{
  checkpointId: string;
  sequence: number;
  runId: string;
  workspaceId: string;
  namespace: string;
  adapterCheckpointKey: string;
  parentCheckpointKey: string | null;
  lineage: readonly string[];
  adapter: GraphExecutionAdapterDescriptor;
  state: HermesJsonValue;
}>;

export type LoadLatestGraphCheckpointRequest = Readonly<{
  runId: string;
  workspaceId: string;
  namespace: string;
}>;

export type LoadGraphCheckpointRequest = Readonly<{
  runId: string;
  workspaceId: string;
  namespace: string;
  adapterCheckpointKey: string;
}>;

export type ListGraphCheckpointsRequest = Readonly<{
  runId: string;
  workspaceId: string;
  namespace: string;
  beforeAdapterCheckpointKey?: string;
  limit: number;
}>;

/**
 * The store must fence this write with `lease.fencingGeneration` and atomically
 * allocate the next Run-wide sequence across every checkpoint namespace.
 */
export type SaveGraphCheckpointRequest = Readonly<{
  lease: RunLease;
  namespace: string;
  adapterCheckpointKey: string;
  parentCheckpointKey: string | null;
  lineage: readonly string[];
  adapter: GraphExecutionAdapterDescriptor;
  state: HermesJsonValue;
}>;

/**
 * Engine-neutral equivalent of an engine's pending task write. Identity is
 * `(taskId, index)` within one checkpoint. Non-negative writes are immutable;
 * engine-reserved negative writes may replace only `type` and `value`, keeping
 * their channel stable. `type` preserves the serializer tag; binary payloads
 * must be represented by the adapter as explicit base64 JSON inside `value`.
 */
export type RuntimeCheckpointPendingWrite = Readonly<{
  taskId: string;
  index: number;
  channel: string;
  type: string;
  value: HermesJsonValue;
}>;

export type RuntimeCheckpointPendingWritesEnvelope = Readonly<{
  schemaVersion: GraphCheckpointPendingWritesSchemaVersion;
  checkpoint: GraphCheckpointReference;
  runId: string;
  workspaceId: string;
  writes: readonly RuntimeCheckpointPendingWrite[];
}>;

export type CreateRuntimeCheckpointPendingWritesEnvelopeInput = Readonly<{
  checkpoint: GraphCheckpointReference;
  runId: string;
  workspaceId: string;
  writes: readonly RuntimeCheckpointPendingWrite[];
}>;

export type LoadRuntimeCheckpointPendingWritesRequest = Readonly<{
  checkpoint: GraphCheckpointReference;
  runId: string;
  workspaceId: string;
}>;

/**
 * Under the supplied fencing lease, stores new writes and type/value updates
 * for negative indexes. Identical retries are a no-op; conflicting non-negative
 * writes and negative-write channel changes must be rejected. The returned
 * envelope contains the merged latest writes for the checkpoint.
 */
export type SaveRuntimeCheckpointPendingWritesRequest = Readonly<{
  lease: RunLease;
  checkpoint: GraphCheckpointReference;
  writes: readonly RuntimeCheckpointPendingWrite[];
}>;

export interface GraphCheckpointStore {
  loadLatest(
    request: LoadLatestGraphCheckpointRequest,
  ): Promise<GraphCheckpointEnvelope | null>;
  load(
    request: LoadGraphCheckpointRequest,
  ): Promise<GraphCheckpointEnvelope | null>;
  list(
    request: ListGraphCheckpointsRequest,
  ): Promise<readonly GraphCheckpointEnvelope[]>;
  save(request: SaveGraphCheckpointRequest): Promise<GraphCheckpointEnvelope>;
  loadPendingWrites(
    request: LoadRuntimeCheckpointPendingWritesRequest,
  ): Promise<RuntimeCheckpointPendingWritesEnvelope>;
  savePendingWrites(
    request: SaveRuntimeCheckpointPendingWritesRequest,
  ): Promise<RuntimeCheckpointPendingWritesEnvelope>;
}

export type GraphCheckpointReference = Readonly<{
  checkpointId: string;
  sequence: number;
  namespace: string;
  adapterCheckpointKey: string;
}>;

export type GraphCheckpointTuple = Readonly<{
  checkpoint: GraphCheckpointEnvelope;
  pendingWrites: RuntimeCheckpointPendingWritesEnvelope;
}>;

export type GraphExecutionOutcome =
  | Readonly<{
      schemaVersion: GraphExecutionOutcomeSchemaVersion;
      output: HermesJsonValue;
      status: "succeeded";
    }>
  | Readonly<{
      schemaVersion: GraphExecutionOutcomeSchemaVersion;
      checkpoint: GraphCheckpointReference;
      status: "waiting";
    }>
  | Readonly<{
      schemaVersion: GraphExecutionOutcomeSchemaVersion;
      status: "cancelled";
    }>
  | Readonly<{
      schemaVersion: GraphExecutionOutcomeSchemaVersion;
      failure: RunFailure;
      status: "failed" | "timedOut";
    }>;

export type SaveGraphCheckpointInput = Readonly<{
  namespace: string;
  adapterCheckpointKey: string;
  parentCheckpointKey: string | null;
  lineage: readonly string[];
  state: HermesJsonValue;
}>;

export type LoadGraphCheckpointInput = Readonly<{
  namespace: string;
  adapterCheckpointKey: string;
}>;

export type ListGraphCheckpointsInput = Readonly<{
  namespace: string;
  beforeAdapterCheckpointKey?: string;
  limit: number;
}>;

export interface GraphCheckpointAccess {
  loadLatest(namespace: string): Promise<GraphCheckpointTuple | null>;
  load(input: LoadGraphCheckpointInput): Promise<GraphCheckpointTuple | null>;
  list(input: ListGraphCheckpointsInput): Promise<readonly GraphCheckpointTuple[]>;
  save(input: SaveGraphCheckpointInput): Promise<GraphCheckpointEnvelope>;
  savePendingWrites(
    checkpoint: GraphCheckpointReference,
    writes: readonly RuntimeCheckpointPendingWrite[],
  ): Promise<RuntimeCheckpointPendingWritesEnvelope>;
}

export type SaveGraphCheckpoint = GraphCheckpointAccess["save"];

export type SaveRuntimeCheckpointPendingWrites = (
  writes: readonly RuntimeCheckpointPendingWrite[],
) => Promise<RuntimeCheckpointPendingWritesEnvelope>;

export type GraphEngineExecutionRequest = Readonly<{
  envelope: GraphExecutionEnvelope;
  /** The tuple selected by `envelope.checkpoint`; it does not follow subgraphs. */
  checkpoint: GraphCheckpointTuple | null;
  checkpoints: GraphCheckpointAccess;
  signal: AbortSignal;
  saveCheckpoint: SaveGraphCheckpoint;
  /**
   * Writes to the current checkpoint in `envelope.checkpoint.namespace`.
   * Use `checkpoints.savePendingWrites` for another namespace.
   */
  savePendingWrites: SaveRuntimeCheckpointPendingWrites;
}>;

/** Implement this interface in the Worker for LangGraph or another engine. */
export interface GraphEngineAdapter {
  readonly descriptor: GraphExecutionAdapterDescriptor;
  execute(request: GraphEngineExecutionRequest): Promise<GraphExecutionOutcome>;
}

/** Stable Worker-facing port. Consumers never need an engine-specific type. */
export interface GraphExecutionPort {
  execute(
    envelope: GraphExecutionEnvelope,
    signal: AbortSignal,
  ): Promise<GraphExecutionOutcome>;
}

export const GRAPH_EXECUTION_BOUNDARY_ERROR_CODES = Object.freeze({
  invalidAdapter: "GRAPH_EXECUTION_ADAPTER_INVALID",
  invalidCheckpoint: "GRAPH_CHECKPOINT_ENVELOPE_INVALID",
  invalidEnvelope: "GRAPH_EXECUTION_ENVELOPE_INVALID",
  invalidOutcome: "GRAPH_EXECUTION_OUTCOME_INVALID",
} as const);

export type GraphExecutionBoundaryErrorCode =
  (typeof GRAPH_EXECUTION_BOUNDARY_ERROR_CODES)[keyof typeof GRAPH_EXECUTION_BOUNDARY_ERROR_CODES];

export class GraphExecutionBoundaryError extends Error {
  constructor(readonly code: GraphExecutionBoundaryErrorCode) {
    super(messageFor(code));
    this.name = "GraphExecutionBoundaryError";
  }
}

export function createGraphExecutionEnvelope(
  input: CreateGraphExecutionEnvelopeInput,
): GraphExecutionEnvelope {
  return readGraphExecutionEnvelope(input, false);
}

export function parseGraphExecutionEnvelope(
  value: unknown,
): GraphExecutionEnvelope {
  return readGraphExecutionEnvelope(value, true);
}

export function createGraphCheckpointEnvelope(
  input: CreateGraphCheckpointEnvelopeInput,
): GraphCheckpointEnvelope {
  return readGraphCheckpointEnvelope(input, false);
}

export function parseGraphCheckpointEnvelope(
  value: unknown,
): GraphCheckpointEnvelope {
  return readGraphCheckpointEnvelope(value, true);
}

export function createRuntimeCheckpointPendingWritesEnvelope(
  input: CreateRuntimeCheckpointPendingWritesEnvelopeInput,
): RuntimeCheckpointPendingWritesEnvelope {
  return readRuntimeCheckpointPendingWritesEnvelope(input, false);
}

export function parseRuntimeCheckpointPendingWritesEnvelope(
  value: unknown,
): RuntimeCheckpointPendingWritesEnvelope {
  return readRuntimeCheckpointPendingWritesEnvelope(value, true);
}

/** Parses and copies an engine result so internal properties cannot escape. */
export function parseGraphExecutionOutcome(
  value: unknown,
): GraphExecutionOutcome {
  try {
    if (!isPlainRecord(value)) throw invalid("invalidOutcome");
    if (value.schemaVersion !== GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION) {
      throw invalid("invalidOutcome");
    }

    switch (value.status) {
      case "succeeded":
        if (!hasExactKeys(value, ["schemaVersion", "output", "status"])) {
          throw invalid("invalidOutcome");
        }
        return Object.freeze({
          schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
          output: copyJson(value.output),
          status: "succeeded",
        });
      case "waiting":
        if (!hasExactKeys(value, ["schemaVersion", "checkpoint", "status"])) {
          throw invalid("invalidOutcome");
        }
        return Object.freeze({
          schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
          checkpoint: readCheckpointReference(value.checkpoint),
          status: "waiting",
        });
      case "cancelled":
        if (!hasExactKeys(value, ["schemaVersion", "status"])) {
          throw invalid("invalidOutcome");
        }
        return cancelledOutcome();
      case "failed":
      case "timedOut":
        if (!hasExactKeys(value, ["schemaVersion", "failure", "status"])) {
          throw invalid("invalidOutcome");
        }
        return Object.freeze({
          schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
          failure: readFailure(value.failure),
          status: value.status,
        });
      default:
        throw invalid("invalidOutcome");
    }
  } catch (error) {
    if (isBoundaryError(error, "invalidOutcome")) throw error;
    throw invalid("invalidOutcome");
  }
}

/**
 * Engine-neutral checkpoint orchestration. A concrete LangGraph adapter only
 * implements `GraphEngineAdapter`; persistence remains a Hermes-owned port.
 */
export class CheckpointAwareGraphExecutor implements GraphExecutionPort {
  private readonly descriptor: GraphExecutionAdapterDescriptor;

  constructor(
    private readonly checkpoints: GraphCheckpointStore,
    private readonly adapter: GraphEngineAdapter,
  ) {
    try {
      if (
        !checkpoints ||
        typeof checkpoints.loadLatest !== "function" ||
        typeof checkpoints.load !== "function" ||
        typeof checkpoints.list !== "function" ||
        typeof checkpoints.save !== "function" ||
        typeof checkpoints.loadPendingWrites !== "function" ||
        typeof checkpoints.savePendingWrites !== "function" ||
        !adapter ||
        typeof adapter.execute !== "function"
      ) {
        throw invalid("invalidAdapter");
      }
      this.descriptor = readAdapterDescriptor(adapter.descriptor);
    } catch (error) {
      if (isBoundaryError(error, "invalidAdapter")) throw error;
      throw invalid("invalidAdapter");
    }
  }

  async execute(
    envelope: GraphExecutionEnvelope,
    signal: AbortSignal,
  ): Promise<GraphExecutionOutcome> {
    const safeEnvelope = parseGraphExecutionEnvelope(envelope);
    if (signal.aborted) return cancelledOutcome();

    try {
      const runScope = Object.freeze({
        runId: safeEnvelope.lease.runId,
        workspaceId: safeEnvelope.lease.workspaceId,
      });
      let latestSequence = 0;
      const knownCheckpoints = new Map<string, GraphCheckpointEnvelope>();
      const currentTuplesByNamespace = new Map<string, GraphCheckpointTuple>();

      const observeCheckpoint = (checkpoint: GraphCheckpointEnvelope) => {
        latestSequence = Math.max(latestSequence, checkpoint.sequence);
        knownCheckpoints.set(checkpointLookupKey(checkpoint), checkpoint);
      };

      const tupleFor = async (
        checkpoint: GraphCheckpointEnvelope,
      ): Promise<GraphCheckpointTuple> => {
        const scope = checkpointScope(runScope, checkpoint.namespace);
        assertCheckpointScope(checkpoint, scope);
        assertCheckpointAdapter(checkpoint, this.descriptor);
        const pendingWrites = parseRuntimeCheckpointPendingWritesEnvelope(
          await this.checkpoints.loadPendingWrites(
            Object.freeze({
              checkpoint: checkpointReference(checkpoint),
              ...runScope,
            }),
          ),
        );
        signal.throwIfAborted();
        assertPendingWritesScope(pendingWrites, scope, checkpoint);
        return Object.freeze({ checkpoint, pendingWrites });
      };

      const loadLatest = async (
        namespace: string,
      ): Promise<GraphCheckpointTuple | null> => {
        signal.throwIfAborted();
        if (!isNamespace(namespace)) throw invalid("invalidCheckpoint");
        const scope = checkpointScope(runScope, namespace);
        const value = await this.checkpoints.loadLatest(scope);
        signal.throwIfAborted();
        if (value === null) return null;
        const checkpoint = parseGraphCheckpointEnvelope(value);
        assertCheckpointScope(checkpoint, scope);
        const tuple = await tupleFor(checkpoint);
        observeCheckpoint(checkpoint);
        currentTuplesByNamespace.set(namespace, tuple);
        return tuple;
      };

      const load = async (
        input: LoadGraphCheckpointInput,
      ): Promise<GraphCheckpointTuple | null> => {
        signal.throwIfAborted();
        if (
          !hasExactKeys(input, ["namespace", "adapterCheckpointKey"]) ||
          !isNamespace(input.namespace) ||
          !isAdapterCheckpointKey(input.adapterCheckpointKey)
        ) {
          throw invalid("invalidCheckpoint");
        }
        const scope = checkpointScope(runScope, input.namespace);
        const value = await this.checkpoints.load(
          Object.freeze({ ...scope, adapterCheckpointKey: input.adapterCheckpointKey }),
        );
        signal.throwIfAborted();
        if (value === null) return null;
        const checkpoint = parseGraphCheckpointEnvelope(value);
        assertCheckpointScope(checkpoint, scope);
        if (checkpoint.adapterCheckpointKey !== input.adapterCheckpointKey) {
          throw invalid("invalidCheckpoint");
        }
        const tuple = await tupleFor(checkpoint);
        observeCheckpoint(checkpoint);
        currentTuplesByNamespace.set(input.namespace, tuple);
        return tuple;
      };

      const list = async (
        input: ListGraphCheckpointsInput,
      ): Promise<readonly GraphCheckpointTuple[]> => {
        signal.throwIfAborted();
        if (
          !hasAllowedKeys(input, ["namespace", "limit"], [
            "beforeAdapterCheckpointKey",
          ]) ||
          !isNamespace(input.namespace) ||
          !Number.isInteger(input.limit) ||
          input.limit < 1 ||
          input.limit > 200 ||
          (Object.hasOwn(input, "beforeAdapterCheckpointKey") &&
            !isAdapterCheckpointKey(input.beforeAdapterCheckpointKey))
        ) {
          throw invalid("invalidCheckpoint");
        }
        const scope = checkpointScope(runScope, input.namespace);
        const values = await this.checkpoints.list(
          Object.freeze({ ...scope, ...input }),
        );
        signal.throwIfAborted();
        if (!Array.isArray(values) || values.length > input.limit) {
          throw invalid("invalidCheckpoint");
        }
        const seen = new Set<string>();
        const tuples: GraphCheckpointTuple[] = [];
        for (const value of values) {
          const checkpoint = parseGraphCheckpointEnvelope(value);
          assertCheckpointScope(checkpoint, scope);
          if (seen.has(checkpoint.adapterCheckpointKey)) {
            throw invalid("invalidCheckpoint");
          }
          seen.add(checkpoint.adapterCheckpointKey);
          const tuple = await tupleFor(checkpoint);
          observeCheckpoint(checkpoint);
          tuples.push(tuple);
        }
        return Object.freeze(tuples);
      };

      const saveCheckpoint: SaveGraphCheckpoint = async (input) => {
        signal.throwIfAborted();
        const safeInput = readSaveGraphCheckpointInput(input);
        const scope = checkpointScope(runScope, safeInput.namespace);
        const lookupKey = checkpointLookupKey(safeInput);
        const known = knownCheckpoints.get(lookupKey);
        const existing =
          known ??
          (
            await load({
              namespace: safeInput.namespace,
              adapterCheckpointKey: safeInput.adapterCheckpointKey,
            })
          )?.checkpoint;
        if (existing) {
          if (!sameCheckpointSave(existing, safeInput, this.descriptor)) {
            throw invalid("invalidCheckpoint");
          }
          const currentTuple = currentTuplesByNamespace.get(
            existing.namespace,
          );
          if (!currentTuple || !checkpointMatchesReference(
            currentTuple.checkpoint,
            checkpointReference(existing),
          )) {
            currentTuplesByNamespace.set(
              existing.namespace,
              await tupleFor(existing),
            );
          }
          return existing;
        }
        const saved = parseGraphCheckpointEnvelope(
          await this.checkpoints.save(
            Object.freeze({
              lease: safeEnvelope.lease,
              ...safeInput,
              adapter: this.descriptor,
            }),
          ),
        );
        signal.throwIfAborted();
        assertCheckpointScope(saved, scope);
        if (
          saved.sequence <= latestSequence ||
          saved.adapterCheckpointKey !== safeInput.adapterCheckpointKey ||
          saved.parentCheckpointKey !== safeInput.parentCheckpointKey ||
          !sameStringArray(saved.lineage, safeInput.lineage) ||
          !sameAdapter(saved.adapter, this.descriptor) ||
          !sameJson(saved.state, safeInput.state)
        ) {
          throw invalid("invalidCheckpoint");
        }
        latestSequence = saved.sequence;
        knownCheckpoints.set(lookupKey, saved);
        currentTuplesByNamespace.set(
          saved.namespace,
          Object.freeze({
            checkpoint: saved,
            pendingWrites: createRuntimeCheckpointPendingWritesEnvelope({
              checkpoint: checkpointReference(saved),
              ...runScope,
              writes: [],
            }),
          }),
        );
        return saved;
      };

      const savePendingFor = async (
        reference: GraphCheckpointReference,
        writes: readonly RuntimeCheckpointPendingWrite[],
      ) => {
        signal.throwIfAborted();
        const safeReference = readCheckpointReference(reference);
        const target = await load({
          namespace: safeReference.namespace,
          adapterCheckpointKey: safeReference.adapterCheckpointKey,
        });
        if (
          !target ||
          target.checkpoint.checkpointId !== safeReference.checkpointId ||
          target.checkpoint.sequence !== safeReference.sequence
        ) {
          throw invalid("invalidCheckpoint");
        }
        const proposed = createRuntimeCheckpointPendingWritesEnvelope({
          checkpoint: safeReference,
          ...runScope,
          writes,
        });
        const existingByKey = indexPendingWrites(target.pendingWrites.writes);
        const writesToSave: RuntimeCheckpointPendingWrite[] = [];
        const expectedByKey = new Map(existingByKey);
        for (const write of proposed.writes) {
          const key = pendingWriteKey(write);
          const existing = existingByKey.get(key);
          if (!existing) {
            writesToSave.push(write);
            expectedByKey.set(key, write);
          } else if (samePendingWrite(existing, write)) {
            continue;
          } else if (write.index >= 0 || write.channel !== existing.channel) {
            throw invalid("invalidCheckpoint");
          } else {
            writesToSave.push(write);
            expectedByKey.set(key, write);
          }
        }
        if (writesToSave.length === 0) return target.pendingWrites;

        const savedWrites = parseRuntimeCheckpointPendingWritesEnvelope(
          await this.checkpoints.savePendingWrites(
            Object.freeze({
              lease: safeEnvelope.lease,
              checkpoint: safeReference,
              writes: Object.freeze(writesToSave),
            }),
          ),
        );
        signal.throwIfAborted();
        assertPendingWritesScope(
          savedWrites,
          checkpointScope(runScope, safeReference.namespace),
          target.checkpoint,
        );
        assertPendingWritesInclude(savedWrites.writes, [
          ...expectedByKey.values(),
        ]);
        const currentTuple = currentTuplesByNamespace.get(
          safeReference.namespace,
        );
        if (
          currentTuple &&
          checkpointMatchesReference(currentTuple.checkpoint, safeReference)
        ) {
          currentTuplesByNamespace.set(
            safeReference.namespace,
            Object.freeze({
              checkpoint: currentTuple.checkpoint,
              pendingWrites: savedWrites,
            }),
          );
        }
        return savedWrites;
      };

      const checkpointAccess: GraphCheckpointAccess = Object.freeze({
        loadLatest,
        load,
        list,
        save: saveCheckpoint,
        savePendingWrites: savePendingFor,
      });

      const latestTuple = await loadLatest(safeEnvelope.checkpoint.namespace);
      const selectedTuple = safeEnvelope.checkpoint.adapterCheckpointKey
        ? latestTuple?.checkpoint.adapterCheckpointKey ===
          safeEnvelope.checkpoint.adapterCheckpointKey
          ? latestTuple
          : await load({
              namespace: safeEnvelope.checkpoint.namespace,
              adapterCheckpointKey:
                safeEnvelope.checkpoint.adapterCheckpointKey,
            })
        : latestTuple;
      if (selectedTuple) {
        currentTuplesByNamespace.set(
          safeEnvelope.checkpoint.namespace,
          selectedTuple,
        );
      }
      if (signal.aborted) return cancelledOutcome();

      const savePendingWrites: SaveRuntimeCheckpointPendingWrites = (writes) => {
        const currentTuple = currentTuplesByNamespace.get(
          safeEnvelope.checkpoint.namespace,
        );
        if (!currentTuple) return Promise.reject(invalid("invalidCheckpoint"));
        return savePendingFor(
          checkpointReference(currentTuple.checkpoint),
          writes,
        );
      };

      const outcome = await this.adapter.execute(
        Object.freeze({
          envelope: safeEnvelope,
          checkpoint: selectedTuple,
          checkpoints: checkpointAccess,
          signal,
          saveCheckpoint,
          savePendingWrites,
        }),
      );
      if (signal.aborted) return cancelledOutcome();
      const parsedOutcome = parseGraphExecutionOutcome(outcome);
      if (parsedOutcome.status === "waiting") {
        const persistedTuple = currentTuplesByNamespace.get(
          parsedOutcome.checkpoint.namespace,
        );
        if (
          !persistedTuple ||
          !checkpointMatchesReference(
            persistedTuple.checkpoint,
            parsedOutcome.checkpoint,
          )
        ) {
          throw invalid("invalidOutcome");
        }
      }
      return parsedOutcome;
    } catch (error) {
      if (signal.aborted) return cancelledOutcome();
      throw error;
    }
  }
}

function readGraphExecutionEnvelope(
  value: unknown,
  includesVersion: boolean,
): GraphExecutionEnvelope {
  try {
    const requiredKeys = includesVersion
      ? ["schemaVersion", "lease", "checkpoint", "graphDefinition", "input"]
      : ["lease", "checkpoint", "graphDefinition", "input"];
    if (!hasAllowedKeys(value, requiredKeys, ["resumeInput"])) {
      throw invalid("invalidEnvelope");
    }
    if (
      includesVersion &&
      value.schemaVersion !== GRAPH_EXECUTION_SCHEMA_VERSION
    ) {
      throw invalid("invalidEnvelope");
    }

    const envelope: {
      schemaVersion: GraphExecutionSchemaVersion;
      lease: RunLease;
      checkpoint: GraphCheckpointSelector;
      graphDefinition: HermesJsonValue;
      input: HermesJsonValue;
      resumeInput?: HermesJsonValue;
    } = {
      schemaVersion: GRAPH_EXECUTION_SCHEMA_VERSION,
      lease: readLease(value.lease),
      checkpoint: readCheckpointSelector(value.checkpoint),
      graphDefinition: copyJson(value.graphDefinition),
      input: copyJson(value.input),
    };
    if (Object.hasOwn(value, "resumeInput")) {
      envelope.resumeInput = copyJson(value.resumeInput);
    }
    return Object.freeze(envelope);
  } catch (error) {
    if (isBoundaryError(error, "invalidEnvelope")) throw error;
    throw invalid("invalidEnvelope");
  }
}

function readGraphCheckpointEnvelope(
  value: unknown,
  includesVersion: boolean,
): GraphCheckpointEnvelope {
  try {
    const keys = includesVersion
      ? [
          "schemaVersion",
          "checkpointId",
          "sequence",
          "runId",
          "workspaceId",
          "namespace",
          "adapterCheckpointKey",
          "parentCheckpointKey",
          "lineage",
          "adapter",
          "state",
        ]
      : [
          "checkpointId",
          "sequence",
          "runId",
          "workspaceId",
          "namespace",
          "adapterCheckpointKey",
          "parentCheckpointKey",
          "lineage",
          "adapter",
          "state",
        ];
    if (!hasExactKeys(value, keys)) throw invalid("invalidCheckpoint");
    if (
      includesVersion &&
      value.schemaVersion !== GRAPH_CHECKPOINT_SCHEMA_VERSION
    ) {
      throw invalid("invalidCheckpoint");
    }
    if (
      !isUuid(value.checkpointId) ||
      !isCheckpointSequence(value.sequence) ||
      !isUuid(value.runId) ||
      !isUuid(value.workspaceId) ||
      !isNamespace(value.namespace) ||
      !isAdapterCheckpointKey(value.adapterCheckpointKey) ||
      (value.parentCheckpointKey !== null &&
        !isAdapterCheckpointKey(value.parentCheckpointKey))
    ) {
      throw invalid("invalidCheckpoint");
    }
    const adapterCheckpointKey = normalizeAdapterCheckpointKey(
      value.adapterCheckpointKey,
    );
    const parentCheckpointKey =
      value.parentCheckpointKey === null
        ? null
        : normalizeAdapterCheckpointKey(value.parentCheckpointKey);
    const lineage = readLineage(
      value.lineage,
      parentCheckpointKey,
      adapterCheckpointKey,
    );
    return Object.freeze({
      schemaVersion: GRAPH_CHECKPOINT_SCHEMA_VERSION,
      checkpointId: value.checkpointId,
      sequence: value.sequence,
      runId: value.runId,
      workspaceId: value.workspaceId,
      namespace: value.namespace,
      adapterCheckpointKey,
      parentCheckpointKey,
      lineage,
      adapter: readAdapterDescriptor(value.adapter),
      state: copyJson(value.state),
    });
  } catch (error) {
    if (isBoundaryError(error, "invalidCheckpoint")) throw error;
    throw invalid("invalidCheckpoint");
  }
}

function readRuntimeCheckpointPendingWritesEnvelope(
  value: unknown,
  includesVersion: boolean,
): RuntimeCheckpointPendingWritesEnvelope {
  try {
    const keys = includesVersion
      ? [
          "schemaVersion",
          "checkpoint",
          "runId",
          "workspaceId",
          "writes",
        ]
      : ["checkpoint", "runId", "workspaceId", "writes"];
    if (!hasExactKeys(value, keys)) throw invalid("invalidCheckpoint");
    if (
      includesVersion &&
      value.schemaVersion !== GRAPH_CHECKPOINT_PENDING_WRITES_SCHEMA_VERSION
    ) {
      throw invalid("invalidCheckpoint");
    }
    if (
      !isUuid(value.runId) ||
      !isUuid(value.workspaceId) ||
      !Array.isArray(value.writes)
    ) {
      throw invalid("invalidCheckpoint");
    }
    const writes = value.writes.map(readPendingWrite);
    writes.sort(comparePendingWrites);
    const indexed = indexPendingWrites(writes);
    if (indexed.size !== writes.length) throw invalid("invalidCheckpoint");

    return Object.freeze({
      schemaVersion: GRAPH_CHECKPOINT_PENDING_WRITES_SCHEMA_VERSION,
      checkpoint: readCheckpointReference(value.checkpoint),
      runId: value.runId,
      workspaceId: value.workspaceId,
      writes: Object.freeze(writes),
    });
  } catch (error) {
    if (isBoundaryError(error, "invalidCheckpoint")) throw error;
    throw invalid("invalidCheckpoint");
  }
}

function readLease(value: unknown): RunLease {
  if (
    !hasExactKeys(value, ["fencingGeneration", "runId", "workspaceId"]) ||
    !Number.isSafeInteger(value.fencingGeneration) ||
    (value.fencingGeneration as number) < 1 ||
    !isUuid(value.runId) ||
    !isUuid(value.workspaceId)
  ) {
    throw new Error("invalid lease");
  }
  return Object.freeze({
    fencingGeneration: value.fencingGeneration as number,
    runId: value.runId,
    workspaceId: value.workspaceId,
  });
}

function readCheckpointSelector(value: unknown): GraphCheckpointSelector {
  if (!hasAllowedKeys(value, ["namespace"], ["adapterCheckpointKey"])) {
    throw new Error("invalid checkpoint selector");
  }
  if (
    !isNamespace(value.namespace) ||
    (Object.hasOwn(value, "adapterCheckpointKey") &&
      !isAdapterCheckpointKey(value.adapterCheckpointKey))
  ) {
    throw new Error("invalid checkpoint selector");
  }
  return Object.freeze({
    namespace: value.namespace,
    ...(Object.hasOwn(value, "adapterCheckpointKey")
      ? {
          adapterCheckpointKey: normalizeAdapterCheckpointKey(
            value.adapterCheckpointKey,
          ),
        }
      : {}),
  });
}

function readAdapterDescriptor(
  value: unknown,
): GraphExecutionAdapterDescriptor {
  if (
    !hasExactKeys(value, ["kind", "checkpointVersion"]) ||
    !isNamespacedKind(value.kind) ||
    !isVersion(value.checkpointVersion)
  ) {
    throw new Error("invalid adapter descriptor");
  }
  return Object.freeze({
    kind: value.kind,
    checkpointVersion: value.checkpointVersion,
  });
}

function readCheckpointReference(value: unknown): GraphCheckpointReference {
  if (
    !hasExactKeys(value, [
      "checkpointId",
      "sequence",
      "namespace",
      "adapterCheckpointKey",
    ]) ||
    !isUuid(value.checkpointId) ||
    !isCheckpointSequence(value.sequence) ||
    !isNamespace(value.namespace) ||
    !isAdapterCheckpointKey(value.adapterCheckpointKey)
  ) {
    throw new Error("invalid checkpoint reference");
  }
  return Object.freeze({
    checkpointId: value.checkpointId,
    sequence: value.sequence,
    namespace: value.namespace,
    adapterCheckpointKey: normalizeAdapterCheckpointKey(
      value.adapterCheckpointKey,
    ),
  });
}

function readPendingWrite(value: unknown): RuntimeCheckpointPendingWrite {
  if (
    !hasExactKeys(value, ["taskId", "index", "channel", "type", "value"]) ||
    typeof value.index !== "number" ||
    !Number.isInteger(value.index) ||
    value.index < -2_147_483_648 ||
    value.index > MAX_CHECKPOINT_SEQUENCE
  ) {
    throw new Error("invalid pending write");
  }
  return Object.freeze({
    taskId: canonicalText(value.taskId, 128, WRITE_TASK_ID_PATTERN),
    index: value.index,
    channel: canonicalText(value.channel, 128, WRITE_CHANNEL_PATTERN),
    type: canonicalText(value.type, 32, WRITE_TYPE_PATTERN),
    value: copyJson(value.value),
  });
}

function readSaveGraphCheckpointInput(
  value: unknown,
): SaveGraphCheckpointInput {
  if (
    !hasExactKeys(value, [
      "namespace",
      "adapterCheckpointKey",
      "parentCheckpointKey",
      "lineage",
      "state",
    ]) ||
    !isNamespace(value.namespace) ||
    !isAdapterCheckpointKey(value.adapterCheckpointKey) ||
    (value.parentCheckpointKey !== null &&
      !isAdapterCheckpointKey(value.parentCheckpointKey))
  ) {
    throw invalid("invalidCheckpoint");
  }
  const adapterCheckpointKey = normalizeAdapterCheckpointKey(
    value.adapterCheckpointKey,
  );
  const parentCheckpointKey =
    value.parentCheckpointKey === null
      ? null
      : normalizeAdapterCheckpointKey(value.parentCheckpointKey);
  return Object.freeze({
    namespace: value.namespace,
    adapterCheckpointKey,
    parentCheckpointKey,
    lineage: readLineage(
      value.lineage,
      parentCheckpointKey,
      adapterCheckpointKey,
    ),
    state: copyCheckpointState(value.state),
  });
}

function readFailure(value: unknown): RunFailure {
  if (
    !hasExactKeys(value, ["code", "message", "retryable"]) ||
    typeof value.code !== "string" ||
    value.code.length < 1 ||
    value.code.length > 128 ||
    typeof value.message !== "string" ||
    value.message.length < 1 ||
    value.message.length > 2_000 ||
    typeof value.retryable !== "boolean"
  ) {
    throw new Error("invalid failure");
  }
  return Object.freeze({
    code: value.code,
    message: value.message,
    retryable: value.retryable,
  });
}

function copyCheckpointState(value: unknown): HermesJsonValue {
  try {
    return copyJson(value);
  } catch {
    throw invalid("invalidCheckpoint");
  }
}

function checkpointScope(
  runScope: Readonly<{ runId: string; workspaceId: string }>,
  namespace: string,
): LoadLatestGraphCheckpointRequest {
  return Object.freeze({ ...runScope, namespace });
}

function copyJson(
  value: unknown,
  active = new WeakSet<object>(),
  depth = 0,
): HermesJsonValue {
  if (depth > MAX_JSON_DEPTH) throw new Error("JSON value is too deep");
  if (
    value === null ||
    typeof value === "boolean" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("invalid JSON number");
    return value;
  }
  if (typeof value !== "object" || active.has(value)) {
    throw new Error("invalid JSON value");
  }

  active.add(value);
  try {
    if (Array.isArray(value)) {
      return Object.freeze(
        value.map((item) => copyJson(item, active, depth + 1)),
      );
    }
    if (!isPlainRecord(value)) throw new Error("invalid JSON object");
    const copy: Record<string, HermesJsonValue> = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string") throw new Error("invalid JSON key");
      Object.defineProperty(copy, key, {
        configurable: false,
        enumerable: true,
        value: copyJson(value[key], active, depth + 1),
        writable: false,
      });
    }
    return Object.freeze(copy);
  } finally {
    active.delete(value);
  }
}

function assertCheckpointScope(
  checkpoint: GraphCheckpointEnvelope,
  scope: LoadLatestGraphCheckpointRequest,
) {
  if (
    checkpoint.runId !== scope.runId ||
    checkpoint.workspaceId !== scope.workspaceId ||
    checkpoint.namespace !== scope.namespace
  ) {
    throw invalid("invalidCheckpoint");
  }
}

function assertCheckpointAdapter(
  checkpoint: GraphCheckpointEnvelope,
  descriptor: GraphExecutionAdapterDescriptor,
) {
  if (!sameAdapter(checkpoint.adapter, descriptor)) {
    throw invalid("invalidCheckpoint");
  }
}

function assertPendingWritesScope(
  envelope: RuntimeCheckpointPendingWritesEnvelope,
  scope: LoadLatestGraphCheckpointRequest,
  checkpoint: GraphCheckpointEnvelope,
) {
  if (
    envelope.runId !== scope.runId ||
    envelope.workspaceId !== scope.workspaceId ||
    envelope.checkpoint.checkpointId !== checkpoint.checkpointId ||
    envelope.checkpoint.sequence !== checkpoint.sequence ||
    envelope.checkpoint.namespace !== checkpoint.namespace ||
    envelope.checkpoint.adapterCheckpointKey !==
      checkpoint.adapterCheckpointKey
  ) {
    throw invalid("invalidCheckpoint");
  }
}

function checkpointReference(
  checkpoint: GraphCheckpointEnvelope,
): GraphCheckpointReference {
  return Object.freeze({
    checkpointId: checkpoint.checkpointId,
    sequence: checkpoint.sequence,
    namespace: checkpoint.namespace,
    adapterCheckpointKey: checkpoint.adapterCheckpointKey,
  });
}

function checkpointMatchesReference(
  checkpoint: GraphCheckpointEnvelope,
  reference: GraphCheckpointReference,
) {
  return (
    checkpoint.checkpointId === reference.checkpointId &&
    checkpoint.sequence === reference.sequence &&
    checkpoint.namespace === reference.namespace &&
    checkpoint.adapterCheckpointKey === reference.adapterCheckpointKey
  );
}

function indexPendingWrites(
  writes: readonly RuntimeCheckpointPendingWrite[],
) {
  const indexed = new Map<string, RuntimeCheckpointPendingWrite>();
  for (const write of writes) {
    const key = pendingWriteKey(write);
    if (indexed.has(key)) throw invalid("invalidCheckpoint");
    indexed.set(key, write);
  }
  return indexed;
}

function pendingWriteKey(write: RuntimeCheckpointPendingWrite) {
  return `${write.taskId}\u0000${write.index}`;
}

function comparePendingWrites(
  left: RuntimeCheckpointPendingWrite,
  right: RuntimeCheckpointPendingWrite,
) {
  return (
    left.taskId.localeCompare(right.taskId) ||
    left.index - right.index ||
    left.channel.localeCompare(right.channel)
  );
}

function samePendingWrite(
  left: RuntimeCheckpointPendingWrite,
  right: RuntimeCheckpointPendingWrite,
) {
  return (
    left.taskId === right.taskId &&
    left.index === right.index &&
    left.channel === right.channel &&
    left.type === right.type &&
    sameJson(left.value, right.value)
  );
}

function sameJson(left: HermesJsonValue, right: HermesJsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (isJsonArray(left) || isJsonArray(right)) {
    return (
      isJsonArray(left) &&
      isJsonArray(right) &&
      left.length === right.length &&
      left.every((value, index) => sameJson(value, right[index]!))
    );
  }
  if (
    left === null ||
    right === null ||
    typeof left !== "object" ||
    typeof right !== "object"
  ) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) && sameJson(left[key]!, right[key]!),
    )
  );
}

function isJsonArray(
  value: HermesJsonValue,
): value is readonly HermesJsonValue[] {
  return Array.isArray(value);
}

function sameAdapter(
  left: GraphExecutionAdapterDescriptor,
  right: GraphExecutionAdapterDescriptor,
) {
  return (
    left.kind === right.kind &&
    left.checkpointVersion === right.checkpointVersion
  );
}

function checkpointLookupKey(value: {
  namespace: string;
  adapterCheckpointKey: string;
}) {
  return `${value.namespace}\u0000${value.adapterCheckpointKey}`;
}

function sameCheckpointSave(
  checkpoint: GraphCheckpointEnvelope,
  input: SaveGraphCheckpointInput,
  adapter: GraphExecutionAdapterDescriptor,
) {
  return (
    checkpoint.namespace === input.namespace &&
    checkpoint.adapterCheckpointKey === input.adapterCheckpointKey &&
    checkpoint.parentCheckpointKey === input.parentCheckpointKey &&
    sameStringArray(checkpoint.lineage, input.lineage) &&
    sameAdapter(checkpoint.adapter, adapter) &&
    sameJson(checkpoint.state, input.state)
  );
}

function sameStringArray(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function assertPendingWritesInclude(
  actual: readonly RuntimeCheckpointPendingWrite[],
  expected: readonly RuntimeCheckpointPendingWrite[],
) {
  const actualByKey = indexPendingWrites(actual);
  for (const write of expected) {
    const saved = actualByKey.get(pendingWriteKey(write));
    if (!saved || !samePendingWrite(saved, write)) {
      throw invalid("invalidCheckpoint");
    }
  }
}

function hasAllowedKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const allowed = new Set([...required, ...optional]);
  const actual = Reflect.ownKeys(value);
  return (
    required.every((key) => Object.hasOwn(value, key)) &&
    actual.every((key) => typeof key === "string" && allowed.has(key))
  );
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  return (
    hasAllowedKeys(value, expected, []) &&
    Reflect.ownKeys(value).length === expected.length
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function isCheckpointSequence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value > 0 &&
    value <= MAX_CHECKPOINT_SEQUENCE
  );
}

function isNamespacedKind(value: unknown): value is RuntimeRunKind {
  return (
    typeof value === "string" &&
    value.length <= 128 &&
    /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value)
  );
}

function isVersion(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    value === value.trim() &&
    /^[A-Za-z0-9][A-Za-z0-9./:_-]*$/.test(value)
  );
}

function isNamespace(value: unknown): value is string {
  return typeof value === "string" && NAMESPACE_PATTERN.test(value);
}

function isAdapterCheckpointKey(value: unknown): value is string {
  return isUuid(value);
}

function normalizeAdapterCheckpointKey(value: unknown) {
  if (!isAdapterCheckpointKey(value)) {
    throw new Error("invalid adapter checkpoint key");
  }
  return value.toLowerCase();
}

function readLineage(
  value: unknown,
  parentCheckpointKey: string | null,
  adapterCheckpointKey: string,
): readonly string[] {
  if (!Array.isArray(value) || !value.every(isAdapterCheckpointKey)) {
    throw new Error("invalid checkpoint lineage");
  }
  const lineage = value.map((item) => item.toLowerCase());
  if (
    new Set(lineage).size !== lineage.length ||
    lineage.includes(adapterCheckpointKey) ||
    (parentCheckpointKey === null && lineage.length !== 0) ||
    (parentCheckpointKey !== null && lineage.at(-1) !== parentCheckpointKey)
  ) {
    throw new Error("invalid checkpoint lineage");
  }
  return Object.freeze(lineage);
}

function canonicalText(value: unknown, maximum: number, pattern: RegExp) {
  if (typeof value !== "string") throw new Error("invalid text");
  const text = value.trim();
  if (text.length < 1 || text.length > maximum || !pattern.test(text)) {
    throw new Error("invalid text");
  }
  return text;
}

function cancelledOutcome(): GraphExecutionOutcome {
  return Object.freeze({
    schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
    status: "cancelled",
  });
}

function invalid(
  key: keyof typeof GRAPH_EXECUTION_BOUNDARY_ERROR_CODES,
) {
  return new GraphExecutionBoundaryError(
    GRAPH_EXECUTION_BOUNDARY_ERROR_CODES[key],
  );
}

function isBoundaryError(
  error: unknown,
  key: keyof typeof GRAPH_EXECUTION_BOUNDARY_ERROR_CODES,
) {
  return (
    error instanceof GraphExecutionBoundaryError &&
    error.code === GRAPH_EXECUTION_BOUNDARY_ERROR_CODES[key]
  );
}

function messageFor(code: GraphExecutionBoundaryErrorCode) {
  switch (code) {
    case GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidAdapter:
      return "Graph execution adapter is invalid.";
    case GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint:
      return "Graph checkpoint envelope is invalid.";
    case GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidEnvelope:
      return "Graph execution envelope is invalid.";
    case GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidOutcome:
      return "Graph execution outcome is invalid.";
  }
}
