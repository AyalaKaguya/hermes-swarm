import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createRuntimeCheckpointAdapterStateEnvelope,
  createRuntimeCheckpointPendingWrite,
  normalizeRuntimeCheckpointAdapterKey,
  normalizeRuntimeCheckpointIdempotencyKey,
  normalizeRuntimeCheckpointNamespace,
  normalizeRuntimeCheckpointStateDigest,
  parseRuntimeCheckpointAdapterStateEnvelope,
  parseRuntimeCheckpointLeaseGeneration,
  parseRuntimeCheckpointSequence,
  RuntimeCheckpointValidationError,
} from "./runtime-checkpoint-state.js";

describe("Runtime checkpoint values", () => {
  it("creates a detached SDK-compatible adapter state envelope", () => {
    const state = [{ channels: { answer: "pending" } }, null, 2];
    const envelope = createRuntimeCheckpointAdapterStateEnvelope({
      adapter: {
        checkpointVersion: " langgraph-state/v1 ",
        kind: " graph.langgraph ",
      },
      state,
    });

    assert.deepEqual(envelope, {
      adapter: {
        checkpointVersion: "langgraph-state/v1",
        kind: "graph.langgraph",
      },
      state,
    });
    state[0] = { channels: { answer: "mutated" } };
    state.push("mutated");
    assert.deepEqual(envelope.state, [
      { channels: { answer: "pending" } },
      null,
      2,
    ]);
    assert.equal(Object.isFrozen(envelope), true);
    assert.equal(Object.isFrozen(envelope.adapter), true);
    assert.equal(Object.isFrozen(envelope.state), true);
  });

  it("parses an exact descriptor and arbitrary JSON state", () => {
    const parsed = parseRuntimeCheckpointAdapterStateEnvelope({
      adapter: {
        checkpointVersion: "langgraph-state/v1",
        kind: "graph.langgraph",
      },
      state: null,
    });

    assert.equal(parsed.adapter.kind, "graph.langgraph");
    assert.equal(parsed.state, null);
    for (const invalid of [
      null,
      {
        adapter: {
          checkpointVersion: "langgraph-state/v1",
          kind: "graph.langgraph",
        },
        extra: true,
        state: {},
      },
      {
        adapter: {
          checkpointVersion: "langgraph-state/v1",
          extra: true,
          kind: "graph.langgraph",
        },
        state: {},
      },
      {
        adapter: {
          checkpointVersion: "langgraph-state/v1",
          kind: "langgraph",
        },
        state: {},
      },
      {
        adapter: {
          checkpointVersion: "version with spaces",
          kind: "graph.langgraph",
        },
        state: {},
      },
    ]) {
      assert.throws(
        () => parseRuntimeCheckpointAdapterStateEnvelope(invalid),
        RuntimeCheckpointValidationError,
      );
    }
  });

  it("rejects non-JSON, non-finite, and cyclic adapter state", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    for (const state of [
      { value: undefined },
      { value: Number.NaN },
      { value: Number.POSITIVE_INFINITY },
      { value: 1n },
      { value: new Date() },
      cyclic,
    ]) {
      assert.throws(
        () =>
          createRuntimeCheckpointAdapterStateEnvelope({
            adapter: {
              checkpointVersion: "langgraph-state/v1",
              kind: "graph.langgraph",
            },
            state,
          }),
        RuntimeCheckpointValidationError,
      );
    }
  });

  it("normalizes immutable typed pending writes", () => {
    const source = { interrupt: ["approval", 1] };
    const write = createRuntimeCheckpointPendingWrite({
      channel: " __interrupt__ ",
      index: -3,
      taskId: " task-1 ",
      type: " json ",
      value: source,
    });

    assert.deepEqual(write, {
      channel: "__interrupt__",
      index: -3,
      taskId: "task-1",
      type: "json",
      value: source,
    });
    source.interrupt.push(2);
    assert.deepEqual(write.value, { interrupt: ["approval", 1] });
    assert.equal(Object.isFrozen(write), true);
    assert.equal(Object.isFrozen(write.value), true);
  });

  it("rejects unbounded or malformed pending-write identity", () => {
    const valid = {
      channel: "channel:result",
      index: 0,
      taskId: "task-1",
      type: "json",
      value: null,
    };
    for (const invalid of [
      { ...valid, channel: "contains whitespace" },
      { ...valid, index: 1.5 },
      { ...valid, index: -2_147_483_649 },
      { ...valid, index: 2_147_483_648 },
      { ...valid, taskId: "*invalid" },
      { ...valid, type: "JSON" },
      { ...valid, type: "x".repeat(33) },
    ]) {
      assert.throws(
        () => createRuntimeCheckpointPendingWrite(invalid),
        RuntimeCheckpointValidationError,
      );
    }
  });

  it("canonicalizes bounded idempotency keys and positive sequences", () => {
    assert.equal(
      normalizeRuntimeCheckpointIdempotencyKey(" run-1:node.model "),
      "run-1:node.model",
    );
    assert.equal(parseRuntimeCheckpointSequence(1), 1);
    assert.equal(parseRuntimeCheckpointSequence("2"), 2);
    assert.equal(parseRuntimeCheckpointLeaseGeneration(7), 7);
    assert.equal(normalizeRuntimeCheckpointNamespace(""), "");
    assert.equal(
      normalizeRuntimeCheckpointNamespace("subgraph:node|child-1"),
      "subgraph:node|child-1",
    );
    assert.equal(
      normalizeRuntimeCheckpointAdapterKey(
        "123E4567-E89B-42D3-A456-426614174000",
      ),
      "123e4567-e89b-42d3-a456-426614174000",
    );
    assert.equal(
      normalizeRuntimeCheckpointStateDigest("a".repeat(64)),
      "a".repeat(64),
    );

    for (const key of ["", "contains whitespace", "*invalid", "a".repeat(201)]) {
      assert.throws(
        () => normalizeRuntimeCheckpointIdempotencyKey(key),
        RuntimeCheckpointValidationError,
      );
    }
    for (const sequence of [0, -1, 1.5, Number.NaN, 2_147_483_648]) {
      assert.throws(
        () => parseRuntimeCheckpointSequence(sequence),
        RuntimeCheckpointValidationError,
      );
    }
    for (const namespace of ["contains whitespace", "x".repeat(501)]) {
      assert.throws(
        () => normalizeRuntimeCheckpointNamespace(namespace),
        RuntimeCheckpointValidationError,
      );
    }
    for (const value of ["not-a-uuid", "A".repeat(64), "a".repeat(63)]) {
      assert.throws(
        () =>
          value === "not-a-uuid"
            ? normalizeRuntimeCheckpointAdapterKey(value)
            : normalizeRuntimeCheckpointStateDigest(value),
        RuntimeCheckpointValidationError,
      );
    }
  });
});
