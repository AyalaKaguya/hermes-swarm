import type { RunnableConfig } from "@langchain/core/runnables";
import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointPendingWrite,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type {
  GraphCheckpointAccess,
  GraphCheckpointTuple,
  HermesJsonValue,
  RuntimeCheckpointPendingWrite,
} from "@hermes-swarm/agent-sdk";

const MAX_LIST_LIMIT = 200;

type EncodedSerdeValue = Readonly<{
  data: string;
  encoding: "base64";
}>;

type LangGraphCheckpointState = Readonly<{
  checkpoint: Readonly<{
    data: string;
    encoding: "base64";
    type: string;
  }>;
  metadata: Readonly<{
    data: string;
    encoding: "base64";
    type: string;
  }>;
}>;

export class HermesLangGraphCheckpointer extends BaseCheckpointSaver {
  constructor(
    private readonly runId: string,
    private readonly checkpoints: GraphCheckpointAccess,
  ) {
    super();
    if (!isUuid(runId) || !checkpoints) throw invalidCheckpointer();
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const selection = this.readConfig(config);
    const tuple = selection.checkpointId
      ? await this.checkpoints.load({
          adapterCheckpointKey: selection.checkpointId,
          namespace: selection.namespace,
        })
      : await this.checkpoints.loadLatest(selection.namespace);
    if (!tuple) return undefined;
    return this.toLangGraphTuple(tuple);
  }

  async *list(
    config: RunnableConfig,
    options: CheckpointListOptions = {},
  ): AsyncGenerator<CheckpointTuple> {
    const selection = this.readConfig(config);
    const requestedLimit = normalizeListLimit(options.limit);
    const before = options.before
      ? this.readConfig(options.before).checkpointId
      : undefined;

    if (selection.checkpointId) {
      if (before && selection.checkpointId >= before) return;
      const tuple = await this.checkpoints.load({
        adapterCheckpointKey: selection.checkpointId,
        namespace: selection.namespace,
      });
      if (tuple && (await this.matchesFilter(tuple, options.filter))) {
        yield await this.toLangGraphTuple(tuple);
      }
      return;
    }

    let remaining = requestedLimit;
    let cursor = before;
    while (remaining > 0) {
      const page = await this.checkpoints.list({
        beforeAdapterCheckpointKey: cursor,
        limit: MAX_LIST_LIMIT,
        namespace: selection.namespace,
      });
      if (page.length === 0) return;
      for (const tuple of page) {
        if (!(await this.matchesFilter(tuple, options.filter))) continue;
        yield await this.toLangGraphTuple(tuple);
        remaining -= 1;
        if (remaining === 0) return;
      }
      if (page.length < MAX_LIST_LIMIT) return;
      cursor = page.at(-1)!.checkpoint.adapterCheckpointKey;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    const selection = this.readConfig(config);
    if (!isUuid(checkpoint.id)) throw invalidCheckpointer();
    const parent = selection.checkpointId
      ? await this.checkpoints.load({
          adapterCheckpointKey: selection.checkpointId,
          namespace: selection.namespace,
        })
      : null;
    if (selection.checkpointId && !parent) throw invalidCheckpointer();

    const [serializedCheckpoint, serializedMetadata] = await Promise.all([
      this.serialize(checkpoint),
      this.serialize(metadata),
    ]);
    const saved = await this.checkpoints.save({
      adapterCheckpointKey: checkpoint.id,
      lineage: parent
        ? Object.freeze([
            ...parent.checkpoint.lineage,
            parent.checkpoint.adapterCheckpointKey,
          ])
        : Object.freeze([]),
      namespace: selection.namespace,
      parentCheckpointKey: parent?.checkpoint.adapterCheckpointKey ?? null,
      state: Object.freeze({
        checkpoint: serializedCheckpoint,
        metadata: serializedMetadata,
      }),
    });
    if (saved.adapterCheckpointKey !== checkpoint.id) {
      throw invalidCheckpointer();
    }
    return runnableConfig(this.runId, selection.namespace, checkpoint.id);
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const selection = this.readConfig(config);
    if (!selection.checkpointId || !isTaskId(taskId)) {
      throw invalidCheckpointer();
    }
    const tuple = await this.checkpoints.load({
      adapterCheckpointKey: selection.checkpointId,
      namespace: selection.namespace,
    });
    if (!tuple) throw invalidCheckpointer();

    const pending = await Promise.all(
      writes.map(async ([channel, value], index) => {
        if (!isChannel(channel)) throw invalidCheckpointer();
        const serialized = await this.serialize(value);
        const writeIndex = Object.hasOwn(WRITES_IDX_MAP, channel)
          ? WRITES_IDX_MAP[channel]!
          : index;
        return Object.freeze({
          channel,
          index: writeIndex,
          taskId,
          type: serialized.type,
          value: Object.freeze({
            data: serialized.data,
            encoding: serialized.encoding,
          }),
        });
      }),
    );
    await this.checkpoints.savePendingWrites(
      checkpointReference(tuple),
      Object.freeze(pending),
    );
  }

  async deleteThread(_threadId: string): Promise<void> {
    throw new Error(
      "Hermes runtime checkpoints are immutable and cannot be deleted by LangGraph.",
    );
  }

  private async toLangGraphTuple(
    tuple: GraphCheckpointTuple,
  ): Promise<CheckpointTuple> {
    const state = readCheckpointState(tuple.checkpoint.state);
    const checkpoint = (await this.deserialize(
      state.checkpoint,
    )) as Checkpoint;
    const metadata = (await this.deserialize(
      state.metadata,
    )) as CheckpointMetadata;
    if (checkpoint.id !== tuple.checkpoint.adapterCheckpointKey) {
      throw invalidCheckpointer();
    }
    const pendingWrites = await Promise.all(
      tuple.pendingWrites.writes.map(async (write) =>
        Object.freeze([
          write.taskId,
          write.channel,
          await this.deserialize({
            ...readEncodedValue(write.value),
            type: write.type,
          }),
        ]) as CheckpointPendingWrite,
      ),
    );
    const result: CheckpointTuple = {
      checkpoint,
      config: runnableConfig(
        this.runId,
        tuple.checkpoint.namespace,
        tuple.checkpoint.adapterCheckpointKey,
      ),
      metadata,
      pendingWrites,
    };
    if (tuple.checkpoint.parentCheckpointKey) {
      result.parentConfig = runnableConfig(
        this.runId,
        tuple.checkpoint.namespace,
        tuple.checkpoint.parentCheckpointKey,
      );
    }
    return result;
  }

  private async matchesFilter(
    tuple: GraphCheckpointTuple,
    filter: Record<string, unknown> | undefined,
  ) {
    if (!filter) return true;
    const state = readCheckpointState(tuple.checkpoint.state);
    const metadata = await this.deserialize(state.metadata);
    if (!isRecord(metadata)) return false;
    return Object.entries(filter).every(
      ([key, value]) => Object.hasOwn(metadata, key) && metadata[key] === value,
    );
  }

  private async serialize(value: unknown) {
    const [type, bytes] = await this.serde.dumpsTyped(value);
    if (!isSerdeType(type) || !(bytes instanceof Uint8Array)) {
      throw invalidCheckpointer();
    }
    return Object.freeze({
      data: Buffer.from(bytes).toString("base64"),
      encoding: "base64" as const,
      type,
    });
  }

  private deserialize(value: EncodedSerdeValue & { type: string }) {
    if (!isSerdeType(value.type)) throw invalidCheckpointer();
    const encoded = readEncodedValue(value);
    return this.serde.loadsTyped(
      value.type,
      Uint8Array.from(Buffer.from(encoded.data, "base64")),
    );
  }

  private readConfig(config: RunnableConfig) {
    const configurable = config?.configurable;
    if (!isRecord(configurable) || configurable.thread_id !== this.runId) {
      throw invalidCheckpointer();
    }
    const namespace = configurable.checkpoint_ns ?? "";
    if (!isNamespace(namespace)) throw invalidCheckpointer();
    const checkpointId = configurable.checkpoint_id;
    if (checkpointId !== undefined && !isUuid(checkpointId)) {
      throw invalidCheckpointer();
    }
    return Object.freeze({
      checkpointId: checkpointId as string | undefined,
      namespace,
    });
  }
}

function checkpointReference(tuple: GraphCheckpointTuple) {
  return Object.freeze({
    adapterCheckpointKey: tuple.checkpoint.adapterCheckpointKey,
    checkpointId: tuple.checkpoint.checkpointId,
    namespace: tuple.checkpoint.namespace,
    sequence: tuple.checkpoint.sequence,
  });
}

function readCheckpointState(value: HermesJsonValue): LangGraphCheckpointState {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["checkpoint", "metadata"])
  ) {
    throw invalidCheckpointer();
  }
  return Object.freeze({
    checkpoint: readSerializedValue(value.checkpoint),
    metadata: readSerializedValue(value.metadata),
  });
}

function readSerializedValue(value: unknown) {
  if (!isRecord(value) || !hasExactKeys(value, ["data", "encoding", "type"])) {
    throw invalidCheckpointer();
  }
  if (!isSerdeType(value.type)) throw invalidCheckpointer();
  return Object.freeze({ ...readEncodedValue(value), type: value.type });
}

function readEncodedValue(value: unknown): EncodedSerdeValue {
  if (
    !isRecord(value) ||
    value.encoding !== "base64" ||
    typeof value.data !== "string" ||
    value.data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value.data,
    )
  ) {
    throw invalidCheckpointer();
  }
  return Object.freeze({ data: value.data, encoding: "base64" });
}

function runnableConfig(
  threadId: string,
  namespace: string,
  checkpointId?: string,
): RunnableConfig {
  return {
    configurable: {
      checkpoint_id: checkpointId,
      checkpoint_ns: namespace,
      thread_id: threadId,
    },
  };
}

function normalizeListLimit(value: number | undefined) {
  if (value === undefined) return MAX_LIST_LIMIT;
  if (!Number.isSafeInteger(value) || value < 1) throw invalidCheckpointer();
  return Math.min(value, MAX_LIST_LIMIT);
}

function isSerdeType(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 32 &&
    /^[a-z][a-z0-9._+-]{0,31}$/.test(value)
  );
}

function isNamespace(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9._:/|@-]{0,500}$/.test(value)
  );
}

function isChannel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9_][A-Za-z0-9._:/-]{0,127}$/.test(value)
  );
}

function isTaskId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value)
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

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(value: Record<string, unknown>, expected: string[]) {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key))
  );
}

function invalidCheckpointer() {
  return new Error("Hermes LangGraph checkpoint value is invalid.");
}
