import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES,
  RUNTIME_RUN_SCHEMA_VERSION,
  RuntimeRunHandlerRegistry,
  RuntimeRunHandlerRegistryError,
  type RunHandler,
  type RunHandlerContext,
} from "../index.js";

const lease = Object.freeze({
  fencingGeneration: 7,
  runId: "223e4567-e89b-12d3-a456-426614174001",
  workspaceId: "323e4567-e89b-12d3-a456-426614174002",
});

describe("RuntimeRunHandlerRegistry", () => {
  it("uses a stable Run schema version", () => {
    assert.equal(RUNTIME_RUN_SCHEMA_VERSION, "hermes.runtime-run/v1");
  });

  it("orders handlers deterministically by namespaced kind", () => {
    const registry = new RuntimeRunHandlerRegistry([
      handler("knowledge.index"),
      handler("agent.graph"),
      handler("analytics.query"),
    ]);

    assert.deepEqual(registry.kinds(), [
      "agent.graph",
      "analytics.query",
      "knowledge.index",
    ]);
    assert.equal(Object.isFrozen(registry.kinds()), true);
    assert.equal(registry.resolve("analytics.query").kind, "analytics.query");
  });

  it("rejects duplicate kinds with a stable error", () => {
    assert.throws(
      () =>
        new RuntimeRunHandlerRegistry([
          handler("analytics.query"),
          handler("analytics.query"),
        ]),
      registryError(RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES.duplicateKind),
    );
  });

  it("rejects invalid and unknown kinds with stable errors", () => {
    assert.throws(
      () => new RuntimeRunHandlerRegistry([handler("not-namespaced" as never)]),
      registryError(RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES.invalidHandler),
    );

    const registry = new RuntimeRunHandlerRegistry([handler("agent.graph")]);
    assert.throws(
      () => registry.resolve("analytics.query"),
      registryError(RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES.unknownKind),
    );
  });

  it("passes the persisted lease and exact cancellation signal to a handler", async () => {
    const received: { context?: RunHandlerContext } = {};
    const cancellable: RunHandler<"analytics.query"> = {
      kind: "analytics.query",
      execute: async (context) => {
        received.context = context;
        if (context.signal.aborted) return { status: "cancelled" };
        return new Promise((resolve) => {
          context.signal.addEventListener(
            "abort",
            () => resolve({ status: "cancelled" }),
            { once: true },
          );
        });
      },
    };
    const registry = new RuntimeRunHandlerRegistry([cancellable]);
    const controller = new AbortController();
    const pending = registry.execute("analytics.query", {
      lease,
      signal: controller.signal,
    });

    controller.abort(new Error("run cancellation requested"));

    assert.deepEqual(await pending, { status: "cancelled" });
    assert.strictEqual(received.context?.signal, controller.signal);
    assert.strictEqual(received.context?.lease, lease);
    assert.equal(received.context?.lease.fencingGeneration, 7);
  });
});

function handler<TKind extends `${string}.${string}`>(kind: TKind): RunHandler<TKind> {
  return {
    kind,
    execute: async () => ({ status: "succeeded" }),
  };
}

function registryError(
  code: (typeof RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES)[keyof typeof RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES],
) {
  return (error: unknown) => {
    assert.ok(error instanceof RuntimeRunHandlerRegistryError);
    assert.equal(error.code, code);
    return true;
  };
}
