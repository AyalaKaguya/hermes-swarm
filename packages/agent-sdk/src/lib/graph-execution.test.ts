import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  GRAPH_CHECKPOINT_PENDING_WRITES_SCHEMA_VERSION,
  GRAPH_CHECKPOINT_SCHEMA_VERSION,
  GRAPH_EXECUTION_BOUNDARY_ERROR_CODES,
  GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
  GRAPH_EXECUTION_SCHEMA_VERSION,
  CheckpointAwareGraphExecutor,
  GraphExecutionBoundaryError,
  createGraphCheckpointEnvelope,
  createGraphExecutionEnvelope,
  createRuntimeCheckpointPendingWritesEnvelope,
  parseGraphExecutionEnvelope,
  parseGraphExecutionOutcome,
  parseRuntimeCheckpointPendingWritesEnvelope,
  type GraphCheckpointEnvelope,
  type GraphCheckpointStore,
  type GraphEngineAdapter,
  type GraphEngineExecutionRequest,
  type GraphExecutionOutcome,
  type HermesJsonValue,
  type RuntimeCheckpointPendingWrite,
  type SaveGraphCheckpointRequest,
  type SaveRuntimeCheckpointPendingWritesRequest,
} from "../index.js";

const ids = {
  checkpoint: "123e4567-e89b-42d3-a456-426614174000",
  run: "223e4567-e89b-42d3-a456-426614174001",
  workspace: "323e4567-e89b-42d3-a456-426614174002",
  otherWorkspace: "423e4567-e89b-42d3-a456-426614174003",
} as const;

const lease = Object.freeze({
  fencingGeneration: 7,
  runId: ids.run,
  workspaceId: ids.workspace,
});

const descriptor = Object.freeze({
  checkpointVersion: "langgraph-state/v1",
  kind: "graph.langgraph",
} as const);

describe("graph execution envelope", () => {
  it("creates a versioned, deeply frozen Hermes-only envelope", () => {
    const source = {
      checkpoint: { namespace: "" },
      graphDefinition: { entryNodeId: "node-a", nodes: ["node-a"] },
      input: { question: "status" },
      lease,
      resumeInput: { approval: true },
    } as const;
    const envelope = createGraphExecutionEnvelope(source);

    assert.deepEqual(envelope, {
      schemaVersion: GRAPH_EXECUTION_SCHEMA_VERSION,
      lease,
      checkpoint: source.checkpoint,
      graphDefinition: source.graphDefinition,
      input: source.input,
      resumeInput: source.resumeInput,
    });
    assert.notStrictEqual(envelope.graphDefinition, source.graphDefinition);
    assert.equal(Object.isFrozen(envelope), true);
    assert.equal(Object.isFrozen(envelope.lease), true);
    assert.equal(Object.isFrozen(envelope.graphDefinition), true);
    assert.equal(Object.isFrozen(envelope.resumeInput), true);
    assert.deepEqual(Object.keys(envelope), [
      "schemaVersion",
      "lease",
      "checkpoint",
      "graphDefinition",
      "input",
      "resumeInput",
    ]);
  });

  it("parses exact envelopes and rejects engine internals or non-JSON state", () => {
    const source = {
      schemaVersion: GRAPH_EXECUTION_SCHEMA_VERSION,
      checkpoint: { namespace: "" },
      graphDefinition: { nodes: [] },
      input: null,
      lease,
    };
    const parsed = parseGraphExecutionEnvelope(source);
    assert.deepEqual(parsed, source);
    assert.notStrictEqual(parsed, source);

    assert.throws(
      () =>
        parseGraphExecutionEnvelope({
          ...source,
          langGraphCheckpointTable: "checkpoints_v2",
        }),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidEnvelope),
    );
    assert.throws(
      () =>
        createGraphExecutionEnvelope({
          checkpoint: { namespace: "" },
          graphDefinition: { compiled: new Date() },
          input: null,
          lease,
        } as never),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidEnvelope),
    );
  });

  it("enforces namespace, UUID checkpoint key, and JSON depth limits", () => {
    const base = {
      graphDefinition: { nodes: [] },
      input: null,
      lease,
    } as const;
    const uppercaseKey = "123E4567-E89B-42D3-A456-426614174000";

    assert.equal(
      createGraphExecutionEnvelope({
        ...base,
        checkpoint: {
          namespace: "subgraph:node|child-1",
          adapterCheckpointKey: uppercaseKey,
        },
      }).checkpoint.adapterCheckpointKey,
      uppercaseKey.toLowerCase(),
    );

    for (const checkpoint of [
      { namespace: "contains whitespace" },
      { namespace: "a".repeat(501) },
      { namespace: "", adapterCheckpointKey: "not-a-uuid" },
    ]) {
      assert.throws(
        () => createGraphExecutionEnvelope({ ...base, checkpoint }),
        boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidEnvelope),
      );
    }

    let maximumDepth: HermesJsonValue = null;
    for (let depth = 0; depth < 64; depth += 1) {
      maximumDepth = [maximumDepth];
    }
    assert.doesNotThrow(() =>
      createGraphExecutionEnvelope({
        ...base,
        checkpoint: { namespace: "" },
        graphDefinition: maximumDepth,
      }),
    );
    assert.throws(
      () =>
        createGraphExecutionEnvelope({
          ...base,
          checkpoint: { namespace: "" },
          graphDefinition: [maximumDepth],
        }),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidEnvelope),
    );
  });

  it("keeps pending task writes in a strict versioned JSON envelope", () => {
    const second = pendingWrite("task-b", 1, "result", { value: 2 });
    const first = pendingWrite("task-a", 0, "result", { value: 1 });
    const envelope = pendingWritesFor(checkpoint(2, null), [second, first]);

    assert.equal(
      envelope.schemaVersion,
      GRAPH_CHECKPOINT_PENDING_WRITES_SCHEMA_VERSION,
    );
    assert.deepEqual(envelope.writes, [first, second]);
    assert.equal(Object.isFrozen(envelope.writes), true);
    assert.equal(Object.isFrozen(envelope.writes[0]?.value), true);
    assert.deepEqual(parseRuntimeCheckpointPendingWritesEnvelope(envelope), envelope);
    assert.deepEqual(
      pendingWritesFor(checkpoint(2, null), [
        pendingWrite(
          "task-special",
          -1,
          "__error__",
          { data: "AQID", encoding: "base64" },
          "msgpack",
        ),
      ]).writes[0]?.index,
      -1,
    );

    assert.throws(
      () =>
        createRuntimeCheckpointPendingWritesEnvelope({
          checkpoint: envelope.checkpoint,
          runId: ids.run,
          workspaceId: ids.workspace,
          writes: [first, { ...first, channel: "conflict" }],
        }),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
    );
    assert.throws(
      () =>
        parseRuntimeCheckpointPendingWritesEnvelope({
          ...envelope,
          langGraphTaskPath: "private",
        }),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
    );

    for (const invalidWrite of [
      { ...first, taskId: "*invalid" },
      { ...first, channel: "contains whitespace" },
      { ...first, type: "JSON" },
    ]) {
      assert.throws(
        () =>
          createRuntimeCheckpointPendingWritesEnvelope({
            checkpoint: envelope.checkpoint,
            runId: ids.run,
            workspaceId: ids.workspace,
            writes: [invalidWrite],
          }),
        boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
      );
    }
  });
});

describe("CheckpointAwareGraphExecutor", () => {
  it("loads the latest checkpoint and exposes fenced sequential saves to the adapter", async () => {
    const loaded = checkpoint(3, { channelValues: { count: 2 } });
    const saves: SaveGraphCheckpointRequest[] = [];
    const loadRequests: unknown[] = [];
    let nextSequence = 4;
    let received: GraphEngineExecutionRequest | undefined;
    const store: GraphCheckpointStore = {
      loadLatest: async (request) => {
        loadRequests.push(request);
        return loaded;
      },
      save: async (request) => {
        saves.push(request);
        return checkpointFromSave(request, nextSequence++);
      },
      load: async (request) =>
        request.adapterCheckpointKey === loaded.adapterCheckpointKey
          ? loaded
          : null,
      list: async () => [loaded],
      loadPendingWrites: async () => pendingWritesFor(loaded, []),
      savePendingWrites: async (request) =>
        pendingWritesFor(request.checkpoint, request.writes),
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        received = request;
        const fourth = {
          namespace: "",
          adapterCheckpointKey: checkpointKey(4),
          parentCheckpointKey: checkpointKey(3),
          lineage: [checkpointKey(1), checkpointKey(2), checkpointKey(3)],
          state: { channelValues: { count: 3 } },
        } as const;
        const savedFourth = await request.saveCheckpoint(fourth);
        assert.strictEqual(await request.saveCheckpoint(fourth), savedFourth);
        await assert.rejects(
          () =>
            request.saveCheckpoint({
              ...fourth,
              state: { channelValues: { count: 999 } },
            }),
          boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
        );
        const saved = await request.saveCheckpoint({
          namespace: "",
          adapterCheckpointKey: checkpointKey(5),
          parentCheckpointKey: checkpointKey(4),
          lineage: [
            checkpointKey(1),
            checkpointKey(2),
            checkpointKey(3),
            checkpointKey(4),
          ],
          state: { channelValues: { count: 4 } },
        });
        return {
          schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
          checkpoint: {
            checkpointId: saved.checkpointId,
            sequence: saved.sequence,
            namespace: saved.namespace,
            adapterCheckpointKey: saved.adapterCheckpointKey,
          },
          status: "waiting",
        };
      },
    };
    const envelope = executionEnvelope({ approval: true });
    const controller = new AbortController();

    const outcome = await new CheckpointAwareGraphExecutor(store, adapter).execute(
      envelope,
      controller.signal,
    );

    assert.deepEqual(loadRequests, [
      { runId: ids.run, workspaceId: ids.workspace, namespace: "" },
    ]);
    assert.strictEqual(received?.signal, controller.signal);
    assert.deepEqual(received?.envelope.resumeInput, { approval: true });
    assert.deepEqual(received?.checkpoint, {
      checkpoint: loaded,
      pendingWrites: pendingWritesFor(loaded, []),
    });
    assert.equal(saves.length, 2);
    assert.strictEqual(saves[0]?.lease, received?.envelope.lease);
    assert.deepEqual(saves[0]?.adapter, descriptor);
    assert.deepEqual(Object.keys(saves[0] ?? {}), [
      "lease",
      "namespace",
      "adapterCheckpointKey",
      "parentCheckpointKey",
      "lineage",
      "state",
      "adapter",
    ]);
    assert.equal(Object.isFrozen(saves[0]?.state), true);
    assert.deepEqual(outcome, {
      schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
      checkpoint: {
        checkpointId: ids.checkpoint,
        sequence: 5,
        namespace: "",
        adapterCheckpointKey: checkpointKey(5),
      },
      status: "waiting",
    });
    assert.equal(Object.isFrozen(outcome), true);
  });

  it("keeps root waiting and direct pending writes scoped after a subgraph save", async () => {
    const root = checkpoint(1, { root: true });
    const stored = new Map<string, GraphCheckpointEnvelope>([
      [checkpointLookupKeyForTest(root), root],
    ]);
    const pendingByCheckpoint = new Map<
      string,
      readonly RuntimeCheckpointPendingWrite[]
    >();
    const pendingSaveRequests: SaveRuntimeCheckpointPendingWritesRequest[] = [];
    const store: GraphCheckpointStore = {
      loadLatest: async (request) =>
        request.namespace === root.namespace ? root : null,
      load: async (request) =>
        stored.get(
          checkpointLookupKeyForTest({
            namespace: request.namespace,
            adapterCheckpointKey: request.adapterCheckpointKey,
          }),
        ) ?? null,
      list: async () => [],
      save: async (request) => {
        const saved = {
          ...checkpointFromSave(request, 2),
          checkpointId: checkpointKey(902),
        };
        stored.set(checkpointLookupKeyForTest(saved), saved);
        return saved;
      },
      loadPendingWrites: async (request) =>
        pendingWritesFor(
          request.checkpoint,
          pendingByCheckpoint.get(checkpointLookupKeyForTest(request.checkpoint)) ??
            [],
        ),
      savePendingWrites: async (request) => {
        pendingSaveRequests.push(request);
        pendingByCheckpoint.set(
          checkpointLookupKeyForTest(request.checkpoint),
          request.writes,
        );
        return pendingWritesFor(request.checkpoint, request.writes);
      },
    };
    const rootWrite = pendingWrite("task-root", 0, "result", {
      approved: true,
    });
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        const selectedRoot = request.checkpoint?.checkpoint;
        assert.equal(selectedRoot?.namespace, "");
        assert.equal(selectedRoot?.adapterCheckpointKey, checkpointKey(1));

        const child = await request.saveCheckpoint({
          namespace: "child:review",
          adapterCheckpointKey: checkpointKey(2),
          parentCheckpointKey: null,
          lineage: [],
          state: { child: true },
        });
        assert.equal(child.namespace, "child:review");
        assert.strictEqual(request.checkpoint?.checkpoint, selectedRoot);

        const savedWrites = await request.savePendingWrites([rootWrite]);
        assert.equal(savedWrites.checkpoint.namespace, "");
        assert.equal(
          savedWrites.checkpoint.adapterCheckpointKey,
          checkpointKey(1),
        );
        return {
          schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
          checkpoint: {
            checkpointId: selectedRoot!.checkpointId,
            sequence: selectedRoot!.sequence,
            namespace: selectedRoot!.namespace,
            adapterCheckpointKey: selectedRoot!.adapterCheckpointKey,
          },
          status: "waiting",
        };
      },
    };

    const outcome = await new CheckpointAwareGraphExecutor(store, adapter).execute(
      executionEnvelope(),
      new AbortController().signal,
    );

    assert.equal(outcome.status, "waiting");
    assert.deepEqual(pendingSaveRequests, [
      {
        lease,
        checkpoint: {
          checkpointId: root.checkpointId,
          sequence: root.sequence,
          namespace: root.namespace,
          adapterCheckpointKey: root.adapterCheckpointKey,
        },
        writes: [rootWrite],
      },
    ]);
  });

  it("accepts waiting for a compatible checkpoint loaded by reference", async () => {
    const loaded = namedCheckpoint({
      adapterCheckpointKey: checkpointKey(31),
      lineage: [],
      namespace: "child:existing",
      parentCheckpointKey: null,
      sequence: 31,
    });
    const store: GraphCheckpointStore = {
      ...emptyStore(),
      load: async (request) =>
        request.namespace === loaded.namespace &&
        request.adapterCheckpointKey === loaded.adapterCheckpointKey
          ? loaded
          : null,
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        assert.equal(request.checkpoint, null);
        const tuple = await request.checkpoints.load({
          namespace: loaded.namespace,
          adapterCheckpointKey: loaded.adapterCheckpointKey,
        });
        assert.ok(tuple);
        return {
          schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
          checkpoint: {
            checkpointId: tuple.checkpoint.checkpointId,
            sequence: tuple.checkpoint.sequence,
            namespace: tuple.checkpoint.namespace,
            adapterCheckpointKey: tuple.checkpoint.adapterCheckpointKey,
          },
          status: "waiting",
        };
      },
    };

    assert.deepEqual(
      await new CheckpointAwareGraphExecutor(store, adapter).execute(
        executionEnvelope(),
        new AbortController().signal,
      ),
      {
        schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
        checkpoint: {
          checkpointId: loaded.checkpointId,
          sequence: loaded.sequence,
          namespace: loaded.namespace,
          adapterCheckpointKey: loaded.adapterCheckpointKey,
        },
        status: "waiting",
      },
    );
  });

  it("requires new saves to follow every checkpoint observed by load and list", async () => {
    const loaded = namedCheckpoint({
      adapterCheckpointKey: checkpointKey(10),
      lineage: [],
      namespace: "branch.loaded",
      parentCheckpointKey: null,
      sequence: 10,
    });
    const listed = namedCheckpoint({
      adapterCheckpointKey: checkpointKey(12),
      lineage: [],
      namespace: "branch.listed",
      parentCheckpointKey: null,
      sequence: 12,
    });
    let saveCount = 0;
    const store: GraphCheckpointStore = {
      ...emptyStore(),
      load: async (request) =>
        request.namespace === loaded.namespace &&
        request.adapterCheckpointKey === loaded.adapterCheckpointKey
          ? loaded
          : null,
      list: async (request) =>
        request.namespace === listed.namespace ? [listed] : [],
      save: async (request) => {
        saveCount += 1;
        return checkpointFromSave(request, 11);
      },
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        assert.ok(
          await request.checkpoints.load({
            namespace: loaded.namespace,
            adapterCheckpointKey: loaded.adapterCheckpointKey,
          }),
        );
        assert.equal(
          (
            await request.checkpoints.list({
              namespace: listed.namespace,
              limit: 1,
            })
          )[0]?.checkpoint.sequence,
          12,
        );
        await assert.rejects(
          () =>
            request.saveCheckpoint({
              namespace: "",
              adapterCheckpointKey: checkpointKey(13),
              parentCheckpointKey: null,
              lineage: [],
              state: { sequence: 13 },
            }),
          boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
        );
        return succeeded(null);
      },
    };

    assert.deepEqual(
      await new CheckpointAwareGraphExecutor(store, adapter).execute(
        executionEnvelope(),
        new AbortController().signal,
      ),
      succeeded(null),
    );
    assert.equal(saveCount, 1);
  });

  it("rejects a checkpoint store response with altered state", async () => {
    const store: GraphCheckpointStore = {
      ...emptyStore(),
      save: async (request) => ({
        ...checkpointFromSave(request, 1),
        state: { altered: true },
      }),
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        await request.saveCheckpoint({
          namespace: "",
          adapterCheckpointKey: checkpointKey(1),
          parentCheckpointKey: null,
          lineage: [],
          state: { altered: false },
        });
        return succeeded(null);
      },
    };

    await assert.rejects(
      () =>
        new CheckpointAwareGraphExecutor(store, adapter).execute(
          executionEnvelope(),
          new AbortController().signal,
        ),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
    );
  });

  it("loads and idempotently saves engine-neutral pending writes", async () => {
    const loaded = checkpoint(2, { values: { count: 1 } });
    const existing = pendingWrite("task-a", 0, "result", { count: 1 });
    const next = pendingWrite("task-a", 1, "result", { count: 2 });
    const saveRequests: unknown[] = [];
    let canonicalWrites: readonly RuntimeCheckpointPendingWrite[] = [existing];
    const store: GraphCheckpointStore = {
      loadLatest: async () => loaded,
      load: async () => loaded,
      list: async () => [loaded],
      save: async (request) => checkpointFromSave(request, 3),
      loadPendingWrites: async () => pendingWritesFor(loaded, canonicalWrites),
      savePendingWrites: async (request) => {
        saveRequests.push(request);
        canonicalWrites = [...canonicalWrites, ...request.writes];
        return pendingWritesFor(loaded, canonicalWrites);
      },
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        assert.deepEqual(request.checkpoint?.pendingWrites.writes, [existing]);
        await request.savePendingWrites([existing]);
        const saved = await request.savePendingWrites([existing, next]);
        assert.deepEqual(saved.writes, [existing, next]);
        await request.savePendingWrites([next]);
        await assert.rejects(
          () =>
            request.savePendingWrites([
              { ...existing, value: { count: 999 } },
            ]),
          boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
        );
        return succeeded(null);
      },
    };

    await new CheckpointAwareGraphExecutor(store, adapter).execute(
      executionEnvelope(),
      new AbortController().signal,
    );

    assert.equal(saveRequests.length, 1);
    assert.deepEqual(saveRequests[0], {
      lease,
      checkpoint: {
        checkpointId: ids.checkpoint,
        sequence: 2,
        namespace: "",
        adapterCheckpointKey: checkpointKey(2),
      },
      writes: [next],
    });
  });

  it("fences type/value replacement for negative pending-write indexes", async () => {
    const loaded = checkpoint(2, { values: { count: 1 } });
    const positive = pendingWrite("task-a", 0, "result", { count: 1 });
    const negative = pendingWrite(
      "task-a",
      -1,
      "__error__",
      { message: "first failure" },
      "json",
    );
    const replacement = pendingWrite(
      "task-a",
      -1,
      "__error__",
      { data: "AQID", encoding: "base64" },
      "msgpack",
    );
    const saveRequests: SaveRuntimeCheckpointPendingWritesRequest[] = [];
    let canonicalWrites: readonly RuntimeCheckpointPendingWrite[] = [
      negative,
      positive,
    ];
    const store: GraphCheckpointStore = {
      loadLatest: async () => loaded,
      load: async () => loaded,
      list: async () => [loaded],
      save: async (request) => checkpointFromSave(request, 3),
      loadPendingWrites: async () => pendingWritesFor(loaded, canonicalWrites),
      savePendingWrites: async (request) => {
        saveRequests.push(request);
        for (const write of request.writes) {
          canonicalWrites = [
            ...canonicalWrites.filter(
              (existing) =>
                existing.taskId !== write.taskId ||
                existing.index !== write.index,
            ),
            write,
          ];
        }
        return pendingWritesFor(loaded, canonicalWrites);
      },
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        assert.deepEqual(request.checkpoint?.pendingWrites.writes, [
          negative,
          positive,
        ]);
        await assert.rejects(
          () =>
            request.savePendingWrites([
              { ...replacement, channel: "__interrupt__" },
            ]),
          boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
        );
        assert.equal(saveRequests.length, 0);

        const saved = await request.savePendingWrites([replacement]);
        assert.deepEqual(saved.writes, [replacement, positive]);
        assert.deepEqual(
          (await request.savePendingWrites([replacement])).writes,
          [replacement, positive],
        );
        return succeeded(null);
      },
    };

    await new CheckpointAwareGraphExecutor(store, adapter).execute(
      executionEnvelope(),
      new AbortController().signal,
    );

    assert.deepEqual(saveRequests, [
      {
        lease,
        checkpoint: {
          checkpointId: ids.checkpoint,
          sequence: 2,
          namespace: "",
          adapterCheckpointKey: checkpointKey(2),
        },
        writes: [replacement],
      },
    ]);
  });

  it("rejects a negative replacement response without merged latest writes", async () => {
    const loaded = checkpoint(2, null);
    const positive = pendingWrite("task-a", 0, "result", { count: 1 });
    const negative = pendingWrite(
      "task-a",
      -1,
      "__error__",
      { message: "first failure" },
    );
    const replacement = pendingWrite(
      "task-a",
      -1,
      "__error__",
      { message: "latest failure" },
    );
    const store: GraphCheckpointStore = {
      ...emptyStore(),
      loadLatest: async () => loaded,
      load: async () => loaded,
      loadPendingWrites: async () =>
        pendingWritesFor(loaded, [negative, positive]),
      savePendingWrites: async () =>
        pendingWritesFor(loaded, [replacement]),
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        await request.savePendingWrites([replacement]);
        return succeeded(null);
      },
    };

    await assert.rejects(
      () =>
        new CheckpointAwareGraphExecutor(store, adapter).execute(
          executionEnvelope(),
          new AbortController().signal,
        ),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
    );
  });

  it("loads by namespace and adapter key, lists before a key, and preserves parent lineage", async () => {
    const selected = namedCheckpoint({
      adapterCheckpointKey: checkpointKey(101),
      lineage: [],
      namespace: "branch.main",
      parentCheckpointKey: null,
      sequence: 1,
    });
    const latest = namedCheckpoint({
      adapterCheckpointKey: checkpointKey(102),
      lineage: [checkpointKey(101)],
      namespace: "branch.main",
      parentCheckpointKey: checkpointKey(101),
      sequence: 3,
    });
    const loadRequests: unknown[] = [];
    const listRequests: unknown[] = [];
    const saveRequests: SaveGraphCheckpointRequest[] = [];
    const store: GraphCheckpointStore = {
      loadLatest: async () => latest,
      load: async (request) => {
        loadRequests.push(request);
        return request.adapterCheckpointKey === selected.adapterCheckpointKey
          ? selected
          : null;
      },
      list: async (request) => {
        listRequests.push(request);
        return [latest, selected];
      },
      save: async (request) => {
        saveRequests.push(request);
        return checkpointFromSave(request, 4);
      },
      loadPendingWrites: async (request) =>
        pendingWritesFor(request.checkpoint, []),
      savePendingWrites: async (request) =>
        pendingWritesFor(request.checkpoint, request.writes),
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        assert.equal(
          request.checkpoint?.checkpoint.adapterCheckpointKey,
          checkpointKey(101),
        );
        const listed = await request.checkpoints.list({
          namespace: "branch.main",
          beforeAdapterCheckpointKey: checkpointKey(104),
          limit: 2,
        });
        assert.deepEqual(
          listed.map((tuple) => tuple.checkpoint.adapterCheckpointKey),
          [checkpointKey(102), checkpointKey(101)],
        );
        const saved = await request.checkpoints.save({
          namespace: "branch.main",
          adapterCheckpointKey: checkpointKey(103),
          parentCheckpointKey: checkpointKey(101),
          lineage: [checkpointKey(101)],
          state: { branch: true },
        });
        return {
          schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
          checkpoint: {
            checkpointId: saved.checkpointId,
            sequence: saved.sequence,
            namespace: saved.namespace,
            adapterCheckpointKey: saved.adapterCheckpointKey,
          },
          status: "waiting",
        };
      },
    };
    const envelope = createGraphExecutionEnvelope({
      checkpoint: {
        namespace: "branch.main",
        adapterCheckpointKey: checkpointKey(101),
      },
      graphDefinition: { nodes: [] },
      input: null,
      lease,
    });

    await new CheckpointAwareGraphExecutor(store, adapter).execute(
      envelope,
      new AbortController().signal,
    );

    assert.deepEqual(loadRequests[0], {
      runId: ids.run,
      workspaceId: ids.workspace,
      namespace: "branch.main",
      adapterCheckpointKey: checkpointKey(101),
    });
    assert.deepEqual(listRequests, [
      {
        runId: ids.run,
        workspaceId: ids.workspace,
        namespace: "branch.main",
        beforeAdapterCheckpointKey: checkpointKey(104),
        limit: 2,
      },
    ]);
    assert.deepEqual(saveRequests[0], {
      lease,
      namespace: "branch.main",
      adapterCheckpointKey: checkpointKey(103),
      parentCheckpointKey: checkpointKey(101),
      lineage: [checkpointKey(101)],
      state: { branch: true },
      adapter: descriptor,
    });
  });

  it("passes fresh execution input and returns a copied structured outcome", async () => {
    let received: GraphEngineExecutionRequest | undefined;
    const output = { answer: "ready" };
    const executor = new CheckpointAwareGraphExecutor(emptyStore(), {
      descriptor,
      execute: async (request) => {
        received = request;
        return {
          schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
          output,
          status: "succeeded",
        };
      },
    });

    const outcome = await executor.execute(executionEnvelope(), new AbortController().signal);

    assert.equal(received?.checkpoint, null);
    assert.equal("resumeInput" in (received?.envelope ?? {}), false);
    assert.deepEqual(outcome, {
      schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
      output,
      status: "succeeded",
    });
    assert.notStrictEqual(
      (outcome as Extract<GraphExecutionOutcome, { status: "succeeded" }>).output,
      output,
    );
    assert.equal(
      Object.isFrozen(
        (outcome as Extract<GraphExecutionOutcome, { status: "succeeded" }>).output,
      ),
      true,
    );
  });

  it("honors cancellation before loading and while the engine is running", async () => {
    let loadCount = 0;
    const preCancelledStore: GraphCheckpointStore = {
      loadLatest: async () => {
        loadCount += 1;
        return null;
      },
      load: async () => null,
      list: async () => [],
      save: async () => checkpoint(1, null),
      loadPendingWrites: async (request) => pendingWritesFor(request.checkpoint, []),
      savePendingWrites: async (request) =>
        pendingWritesFor(request.checkpoint, request.writes),
    };
    const neverCalled: GraphEngineAdapter = {
      descriptor,
      execute: async () => succeeded(null),
    };
    const preCancelled = new AbortController();
    preCancelled.abort(new Error("cancelled before execution"));

    assert.deepEqual(
      await new CheckpointAwareGraphExecutor(
        preCancelledStore,
        neverCalled,
      ).execute(executionEnvelope(), preCancelled.signal),
      cancelled(),
    );
    assert.equal(loadCount, 0);

    let entered!: () => void;
    const adapterEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let receivedSignal: AbortSignal | undefined;
    const running: GraphEngineAdapter = {
      descriptor,
      execute: async ({ signal }) => {
        receivedSignal = signal;
        entered();
        return new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), {
            once: true,
          });
        });
      },
    };
    const controller = new AbortController();
    const pending = new CheckpointAwareGraphExecutor(emptyStore(), running).execute(
      executionEnvelope(),
      controller.signal,
    );
    await adapterEntered;
    controller.abort(new Error("run cancellation requested"));

    assert.deepEqual(await pending, cancelled());
    assert.strictEqual(receivedSignal, controller.signal);
  });

  it("rejects cross-scope checkpoints and engine-specific outcome fields", async () => {
    const crossScope = {
      ...checkpoint(1, null),
      workspaceId: ids.otherWorkspace,
    };
    const invalidStore: GraphCheckpointStore = {
      ...emptyStore(),
      loadLatest: async () => crossScope,
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async () => succeeded(null),
    };
    await assert.rejects(
      () =>
        new CheckpointAwareGraphExecutor(invalidStore, adapter).execute(
          executionEnvelope(),
          new AbortController().signal,
        ),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
    );

    const leakingAdapter: GraphEngineAdapter = {
      descriptor,
      execute: async () =>
        ({
          ...succeeded(null),
          langGraphTaskWrites: ["private-row"],
        }) as GraphExecutionOutcome,
    };
    await assert.rejects(
      () =>
        new CheckpointAwareGraphExecutor(emptyStore(), leakingAdapter).execute(
          executionEnvelope(),
          new AbortController().signal,
      ),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidOutcome),
    );

    const fabricatedWaiting: GraphEngineAdapter = {
      descriptor,
      execute: async () => ({
        schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
        checkpoint: {
          checkpointId: ids.checkpoint,
          sequence: 1,
          namespace: "",
          adapterCheckpointKey: checkpointKey(1),
        },
        status: "waiting",
      }),
    };
    await assert.rejects(
      () =>
        new CheckpointAwareGraphExecutor(
          emptyStore(),
          fabricatedWaiting,
        ).execute(executionEnvelope(), new AbortController().signal),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidOutcome),
    );
  });

  it("rejects incompatible checkpoint adapters returned by load and list", async () => {
    const incompatibleLoad = {
      ...namedCheckpoint({
        adapterCheckpointKey: checkpointKey(201),
        lineage: [],
        namespace: "branch.load",
        parentCheckpointKey: null,
        sequence: 1,
      }),
      adapter: {
        ...descriptor,
        checkpointVersion: "langgraph-state/v2",
      },
    };
    const incompatibleList = {
      ...namedCheckpoint({
        adapterCheckpointKey: checkpointKey(202),
        lineage: [],
        namespace: "branch.list",
        parentCheckpointKey: null,
        sequence: 2,
      }),
      adapter: {
        ...descriptor,
        kind: "graph.other",
      },
    } as const;
    let pendingWritesLoadCount = 0;
    const store: GraphCheckpointStore = {
      ...emptyStore(),
      load: async (request) =>
        request.namespace === incompatibleLoad.namespace
          ? incompatibleLoad
          : null,
      list: async (request) =>
        request.namespace === incompatibleList.namespace
          ? [incompatibleList]
          : [],
      loadPendingWrites: async (request) => {
        pendingWritesLoadCount += 1;
        return pendingWritesFor(request.checkpoint, []);
      },
    };
    const adapter: GraphEngineAdapter = {
      descriptor,
      execute: async (request) => {
        await assert.rejects(
          () =>
            request.checkpoints.load({
              namespace: incompatibleLoad.namespace,
              adapterCheckpointKey:
                incompatibleLoad.adapterCheckpointKey,
            }),
          boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
        );
        await assert.rejects(
          () =>
            request.checkpoints.list({
              namespace: incompatibleList.namespace,
              limit: 1,
            }),
          boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidCheckpoint),
        );
        return succeeded(null);
      },
    };

    assert.deepEqual(
      await new CheckpointAwareGraphExecutor(store, adapter).execute(
        executionEnvelope(),
        new AbortController().signal,
      ),
      succeeded(null),
    );
    assert.equal(pendingWritesLoadCount, 0);
  });
});

describe("graph execution outcomes", () => {
  it("accepts exact failure outcomes and rejects malformed variants", () => {
    const failed = {
      schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
      failure: {
        code: "AI_GRAPH_EXECUTION_FAILED",
        message: "Graph execution failed.",
        retryable: true,
      },
      status: "failed",
    } as const;

    assert.deepEqual(parseGraphExecutionOutcome(failed), failed);
    assert.throws(
      () => parseGraphExecutionOutcome({ ...failed, stack: "private" }),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidOutcome),
    );
    assert.throws(
      () =>
        parseGraphExecutionOutcome({
          ...failed,
          schemaVersion: "hermes.graph-execution-outcome/v2",
        }),
      boundaryError(GRAPH_EXECUTION_BOUNDARY_ERROR_CODES.invalidOutcome),
    );
  });
});

function executionEnvelope(resumeInput?: { approval: boolean }) {
  return createGraphExecutionEnvelope({
    checkpoint: { namespace: "" },
    graphDefinition: { entryNodeId: "node-a", nodes: ["node-a"] },
    input: { question: "status" },
    lease,
    ...(resumeInput ? { resumeInput } : {}),
  });
}

function checkpoint(
  sequence: number,
  state: Parameters<typeof createGraphCheckpointEnvelope>[0]["state"],
): GraphCheckpointEnvelope {
  return createGraphCheckpointEnvelope({
    adapter: descriptor,
    adapterCheckpointKey: checkpointKey(sequence),
    checkpointId: ids.checkpoint,
    lineage: Array.from(
      { length: Math.max(0, sequence - 1) },
      (_, index) => checkpointKey(index + 1),
    ),
    namespace: "",
    parentCheckpointKey: sequence > 1 ? checkpointKey(sequence - 1) : null,
    runId: ids.run,
    sequence,
    state,
    workspaceId: ids.workspace,
  });
}

function namedCheckpoint(input: {
  adapterCheckpointKey: string;
  lineage: readonly string[];
  namespace: string;
  parentCheckpointKey: string | null;
  sequence: number;
}) {
  return createGraphCheckpointEnvelope({
    adapter: descriptor,
    checkpointId: ids.checkpoint,
    state: { sequence: input.sequence },
    runId: ids.run,
    workspaceId: ids.workspace,
    ...input,
  });
}

function checkpointFromSave(
  request: SaveGraphCheckpointRequest,
  sequence: number,
): GraphCheckpointEnvelope {
  return createGraphCheckpointEnvelope({
    adapter: request.adapter,
    adapterCheckpointKey: request.adapterCheckpointKey,
    checkpointId: ids.checkpoint,
    lineage: request.lineage,
    namespace: request.namespace,
    parentCheckpointKey: request.parentCheckpointKey,
    runId: request.lease.runId,
    sequence,
    state: request.state,
    workspaceId: request.lease.workspaceId,
  });
}

function emptyStore(): GraphCheckpointStore {
  return {
    loadLatest: async () => null,
    load: async () => null,
    list: async () => [],
    save: async (request) => checkpointFromSave(request, 1),
    loadPendingWrites: async (request) => pendingWritesFor(request.checkpoint, []),
    savePendingWrites: async (request) =>
      pendingWritesFor(request.checkpoint, request.writes),
  };
}

function pendingWritesFor(
  checkpoint: {
    checkpointId: string;
    sequence: number;
    namespace: string;
    adapterCheckpointKey: string;
  },
  writes: readonly RuntimeCheckpointPendingWrite[],
) {
  return createRuntimeCheckpointPendingWritesEnvelope({
    checkpoint: {
      checkpointId: checkpoint.checkpointId,
      sequence: checkpoint.sequence,
      namespace: checkpoint.namespace,
      adapterCheckpointKey: checkpoint.adapterCheckpointKey,
    },
    runId: ids.run,
    workspaceId: ids.workspace,
    writes,
  });
}

function pendingWrite(
  taskId: string,
  index: number,
  channel: string,
  value: RuntimeCheckpointPendingWrite["value"],
  type = "json",
): RuntimeCheckpointPendingWrite {
  return { taskId, index, channel, type, value };
}

function checkpointKey(sequence: number) {
  return `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`;
}

function checkpointLookupKeyForTest(value: {
  namespace: string;
  adapterCheckpointKey: string;
}) {
  return `${value.namespace}\u0000${value.adapterCheckpointKey}`;
}

function succeeded(output: null): GraphExecutionOutcome {
  return {
    schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
    output,
    status: "succeeded",
  };
}

function cancelled(): GraphExecutionOutcome {
  return {
    schemaVersion: GRAPH_EXECUTION_OUTCOME_SCHEMA_VERSION,
    status: "cancelled",
  };
}

function boundaryError(
  code: (typeof GRAPH_EXECUTION_BOUNDARY_ERROR_CODES)[keyof typeof GRAPH_EXECUTION_BOUNDARY_ERROR_CODES],
) {
  return (error: unknown) => {
    assert.ok(error instanceof GraphExecutionBoundaryError);
    assert.equal(error.code, code);
    return true;
  };
}

assert.equal(GRAPH_CHECKPOINT_SCHEMA_VERSION, "hermes.graph-checkpoint/v1");
