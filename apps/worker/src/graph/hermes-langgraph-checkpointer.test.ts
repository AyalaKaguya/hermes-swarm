import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import {
  Annotation,
  END,
  START,
  StateGraph,
} from "@langchain/langgraph";
import { emptyCheckpoint } from "@langchain/langgraph-checkpoint";
import {
  createGraphCheckpointEnvelope,
  createGraphExecutionEnvelope,
  createRuntimeCheckpointPendingWritesEnvelope,
  type GraphCheckpointAccess,
  type GraphCheckpointEnvelope,
  type GraphCheckpointReference,
  type GraphCheckpointTuple,
  type HermesJsonValue,
  type RuntimeCheckpointPendingWrite,
} from "@hermes-swarm/agent-sdk";
import { HermesLangGraphCheckpointer } from "./hermes-langgraph-checkpointer.js";
import { LangGraphEngineAdapter } from "./langgraph-engine.adapter.js";

describe("HermesLangGraphCheckpointer", () => {
  it("round-trips serializer bytes and preserves official negative write indexes", async () => {
    const access = new InMemoryCheckpointAccess();
    const checkpointer = new HermesLangGraphCheckpointer(RUN_ID, access);
    const checkpoint = { ...emptyCheckpoint(), id: CHECKPOINT_A };
    const config = await checkpointer.put(
      runnableConfig(),
      checkpoint,
      { parents: {}, source: "input", step: -1 },
      {},
    );

    await checkpointer.putWrites(
      config,
      [
        ["__error__", new Uint8Array([1, 2, 3])],
        ["result", { ok: true }],
      ],
      "task-1",
    );

    const stored = access.pendingWrites();
    assert.deepEqual(
      stored.map(({ channel, index }) => ({ channel, index })),
      [
        { channel: "__error__", index: -1 },
        { channel: "result", index: 1 },
      ],
    );
    assert.equal(stored[0]?.type, "bytes");
    assert.deepEqual(stored[0]?.value, {
      data: "AQID",
      encoding: "base64",
    });

    const restored = await checkpointer.getTuple(config);
    assert.ok(restored);
    assert.equal(restored.checkpoint.id, CHECKPOINT_A);
    assert.deepEqual(restored.pendingWrites?.[0], [
      "task-1",
      "__error__",
      new Uint8Array([1, 2, 3]),
    ]);
    assert.deepEqual(restored.pendingWrites?.[1], [
      "task-1",
      "result",
      { ok: true },
    ]);
  });

  it("resumes a real StateGraph from PostgreSQL-shaped state without rerunning completed nodes", async () => {
    const access = new InMemoryCheckpointAccess();
    let firstRuns = 0;
    let secondRuns = 0;
    const State = Annotation.Root({
      visits: Annotation<string[]>({
        default: () => [],
        reducer: (left, right) => [...left, ...right],
      }),
    });
    const buildGraph = (
      checkpointer: HermesLangGraphCheckpointer,
      interruptAfterFirst: boolean,
    ) =>
      new StateGraph(State)
        .addNode("first", () => {
          firstRuns += 1;
          return { visits: ["first"] };
        })
        .addNode("second", () => {
          secondRuns += 1;
          return { visits: ["second"] };
        })
        .addEdge(START, "first")
        .addEdge("first", "second")
        .addEdge("second", END)
        .compile({
          checkpointer,
          ...(interruptAfterFirst ? { interruptAfter: ["first"] } : {}),
        });

    const firstWorker = buildGraph(
      new HermesLangGraphCheckpointer(RUN_ID, access),
      true,
    );
    const interrupted = await firstWorker.invoke(
      { visits: [] },
      runnableConfig(),
    );
    assert.deepEqual(interrupted.visits, ["first"]);
    assert.equal(firstRuns, 1);
    assert.equal(secondRuns, 0);

    const restartedWorker = buildGraph(
      new HermesLangGraphCheckpointer(RUN_ID, access),
      false,
    );
    const resumed = await restartedWorker.invoke(null, runnableConfig());

    assert.deepEqual(resumed.visits, ["first", "second"]);
    assert.equal(firstRuns, 1);
    assert.equal(secondRuns, 1);
    assert.ok(access.checkpointCount >= 3);
  });

  it("executes a real StateGraph behind the engine-neutral Worker adapter", async () => {
    const access = new InMemoryCheckpointAccess();
    const State = Annotation.Root({
      value: Annotation<number>(),
    });
    const adapter = new LangGraphEngineAdapter({
      compile: ({ checkpointer }) =>
        new StateGraph(State)
          .addNode("increment", (state) => ({ value: state.value + 1 }))
          .addEdge(START, "increment")
          .addEdge("increment", END)
          .compile({ checkpointer }),
    });
    const envelope = createGraphExecutionEnvelope({
      checkpoint: { namespace: "" },
      graphDefinition: { schemaVersion: "test.graph/v1" },
      input: { value: 1 },
      lease: LEASE,
    });

    const outcome = await adapter.execute({
      checkpoint: null,
      checkpoints: access,
      envelope,
      saveCheckpoint: (input) => access.save(input),
      savePendingWrites: async () => {
        throw new Error("No current checkpoint");
      },
      signal: new AbortController().signal,
    });

    assert.equal(outcome.status, "succeeded");
    if (outcome.status !== "succeeded") assert.fail("expected success");
    assert.deepEqual(outcome.output, { value: 2 });
    assert.ok(access.checkpointCount >= 2);
  });

  it("returns a durable waiting outcome when a real StateGraph pauses", async () => {
    const access = new InMemoryCheckpointAccess();
    const State = Annotation.Root({
      visits: Annotation<string[]>({
        default: () => [],
        reducer: (left, right) => [...left, ...right],
      }),
    });
    const adapter = new LangGraphEngineAdapter({
      compile: ({ checkpointer }) =>
        new StateGraph(State)
          .addNode("first", () => ({ visits: ["first"] }))
          .addNode("second", () => ({ visits: ["second"] }))
          .addEdge(START, "first")
          .addEdge("first", "second")
          .addEdge("second", END)
          .compile({ checkpointer, interruptAfter: ["first"] }),
    });

    const outcome = await adapter.execute({
      checkpoint: null,
      checkpoints: access,
      envelope: createGraphExecutionEnvelope({
        checkpoint: { namespace: "" },
        graphDefinition: { schemaVersion: "test.graph/v1" },
        input: { visits: [] },
        lease: LEASE,
      }),
      saveCheckpoint: (input) => access.save(input),
      savePendingWrites: async () => {
        throw new Error("No current checkpoint");
      },
      signal: new AbortController().signal,
    });

    assert.equal(outcome.status, "waiting");
    if (outcome.status !== "waiting") assert.fail("expected waiting");
    const latest = await access.loadLatest("");
    assert.ok(latest);
    assert.deepEqual(outcome.checkpoint, checkpointReference(latest.checkpoint));
  });

  it("rejects a non-root top-level checkpoint namespace before compiling", async () => {
    let compiled = false;
    const adapter = new LangGraphEngineAdapter({
      compile: () => {
        compiled = true;
        throw new Error("must not compile");
      },
    });

    await assert.rejects(
      () =>
        adapter.execute({
          checkpoint: null,
          checkpoints: new InMemoryCheckpointAccess(),
          envelope: createGraphExecutionEnvelope({
            checkpoint: { namespace: "child:graph" },
            graphDefinition: {},
            input: {},
            lease: LEASE,
          }),
          saveCheckpoint: async () => assert.fail("must not save"),
          savePendingWrites: async () => assert.fail("must not save"),
          signal: new AbortController().signal,
        }),
      /root checkpoint namespace/,
    );
    assert.equal(compiled, false);
  });

  it("does not compile a graph after cancellation", async () => {
    let compiled = false;
    const adapter = new LangGraphEngineAdapter({
      compile: () => {
        compiled = true;
        throw new Error("must not compile");
      },
    });
    const controller = new AbortController();
    controller.abort();

    const outcome = await adapter.execute({
      checkpoint: null,
      checkpoints: new InMemoryCheckpointAccess(),
      envelope: createGraphExecutionEnvelope({
        checkpoint: { namespace: "" },
        graphDefinition: {},
        input: {},
        lease: LEASE,
      }),
      saveCheckpoint: async () => assert.fail("must not save"),
      savePendingWrites: async () => assert.fail("must not save"),
      signal: controller.signal,
    });

    assert.equal(outcome.status, "cancelled");
    assert.equal(compiled, false);
  });
});

class InMemoryCheckpointAccess implements GraphCheckpointAccess {
  private readonly checkpoints: GraphCheckpointEnvelope[] = [];
  private readonly writes = new Map<string, RuntimeCheckpointPendingWrite[]>();

  get checkpointCount() {
    return this.checkpoints.length;
  }

  pendingWrites() {
    return [...this.writes.values()].flat();
  }

  async loadLatest(namespace: string) {
    const checkpoint = this.checkpoints
      .filter((item) => item.namespace === namespace)
      .sort((left, right) => right.sequence - left.sequence)[0];
    return checkpoint ? this.tuple(checkpoint) : null;
  }

  async load(input: { namespace: string; adapterCheckpointKey: string }) {
    const checkpoint = this.checkpoints.find(
      (item) =>
        item.namespace === input.namespace &&
        item.adapterCheckpointKey === input.adapterCheckpointKey,
    );
    return checkpoint ? this.tuple(checkpoint) : null;
  }

  async list(input: {
    namespace: string;
    beforeAdapterCheckpointKey?: string;
    limit: number;
  }) {
    const before = input.beforeAdapterCheckpointKey
      ? this.checkpoints.find(
          (item) =>
            item.namespace === input.namespace &&
            item.adapterCheckpointKey === input.beforeAdapterCheckpointKey,
        )?.sequence
      : undefined;
    const selected = this.checkpoints
      .filter(
        (item) =>
          item.namespace === input.namespace &&
          (before === undefined || item.sequence < before),
      )
      .sort((left, right) => right.sequence - left.sequence)
      .slice(0, input.limit);
    return Promise.all(selected.map((item) => this.tuple(item)));
  }

  async save(input: {
    namespace: string;
    adapterCheckpointKey: string;
    parentCheckpointKey: string | null;
    lineage: readonly string[];
    state: HermesJsonValue;
  }) {
    const existing = this.checkpoints.find(
      (item) =>
        item.namespace === input.namespace &&
        item.adapterCheckpointKey === input.adapterCheckpointKey,
    );
    if (existing) return existing;
    const checkpoint = createGraphCheckpointEnvelope({
      adapter: {
        checkpointVersion: "langgraph.checkpoint/v4-jsonplus/v1",
        kind: "langgraph.state",
      },
      adapterCheckpointKey: input.adapterCheckpointKey,
      checkpointId: randomUUID(),
      lineage: input.lineage,
      namespace: input.namespace,
      parentCheckpointKey: input.parentCheckpointKey,
      runId: RUN_ID,
      sequence: this.checkpoints.length + 1,
      state: input.state,
      workspaceId: WORKSPACE_ID,
    });
    this.checkpoints.push(checkpoint);
    return checkpoint;
  }

  async savePendingWrites(
    checkpoint: GraphCheckpointReference,
    proposed: readonly RuntimeCheckpointPendingWrite[],
  ) {
    const key = checkpoint.checkpointId;
    const existing = this.writes.get(key) ?? [];
    const byKey = new Map(
      existing.map((write) => [`${write.taskId}:${write.index}`, write]),
    );
    for (const write of proposed) {
      const identity = `${write.taskId}:${write.index}`;
      const saved = byKey.get(identity);
      if (!saved) byKey.set(identity, write);
      else assert.deepEqual(saved, write);
    }
    const writes = [...byKey.values()];
    this.writes.set(key, writes);
    return createRuntimeCheckpointPendingWritesEnvelope({
      checkpoint,
      runId: RUN_ID,
      workspaceId: WORKSPACE_ID,
      writes,
    });
  }

  private async tuple(
    checkpoint: GraphCheckpointEnvelope,
  ): Promise<GraphCheckpointTuple> {
    const reference = checkpointReference(checkpoint);
    return Object.freeze({
      checkpoint,
      pendingWrites: createRuntimeCheckpointPendingWritesEnvelope({
        checkpoint: reference,
        runId: RUN_ID,
        workspaceId: WORKSPACE_ID,
        writes: this.writes.get(checkpoint.checkpointId) ?? [],
      }),
    });
  }
}

function checkpointReference(checkpoint: GraphCheckpointEnvelope) {
  return Object.freeze({
    adapterCheckpointKey: checkpoint.adapterCheckpointKey,
    checkpointId: checkpoint.checkpointId,
    namespace: checkpoint.namespace,
    sequence: checkpoint.sequence,
  });
}

function runnableConfig() {
  return {
    configurable: {
      checkpoint_ns: "",
      thread_id: RUN_ID,
    },
  };
}

const WORKSPACE_ID = "018f80c0-0000-7000-8000-000000000001";
const RUN_ID = "018f80c0-0000-7000-8000-000000000002";
const CHECKPOINT_A = "018f80c0-0000-7000-8000-000000000003";
const LEASE = Object.freeze({
  fencingGeneration: 1,
  runId: RUN_ID,
  workspaceId: WORKSPACE_ID,
});
