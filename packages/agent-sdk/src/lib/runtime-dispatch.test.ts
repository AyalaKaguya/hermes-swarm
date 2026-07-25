import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  RUNTIME_DISPATCH_ENVELOPE_VALIDATION_ERROR_CODE,
  RUNTIME_DISPATCH_SCHEMA_VERSION,
  RuntimeDispatchEnvelopeValidationError,
  createRuntimeDispatchEnvelope,
  parseRuntimeDispatchEnvelope,
} from "../index.js";

const dispatchId = "123e4567-e89b-12d3-a456-426614174000";
const runId = "223e4567-e89b-12d3-a456-426614174001";

describe("RuntimeDispatchEnvelope", () => {
  it("creates a frozen, minimal versioned envelope", () => {
    const envelope = createRuntimeDispatchEnvelope({ dispatchId, runId });

    assert.deepEqual(envelope, {
      schemaVersion: "hermes.runtime-dispatch/v1",
      dispatchId,
      runId,
    });
    assert.deepEqual(Object.keys(envelope), [
      "schemaVersion",
      "dispatchId",
      "runId",
    ]);
    assert.equal(envelope.schemaVersion, RUNTIME_DISPATCH_SCHEMA_VERSION);
    assert.equal(Object.isFrozen(envelope), true);
  });

  it("parses into a new minimal object", () => {
    const source = {
      schemaVersion: RUNTIME_DISPATCH_SCHEMA_VERSION,
      dispatchId,
      runId,
    };
    const parsed = parseRuntimeDispatchEnvelope(source);

    assert.deepEqual(parsed, source);
    assert.notStrictEqual(parsed, source);
    assert.equal(Object.isFrozen(parsed), true);
  });

  it("rejects missing, malformed, or incorrectly versioned data", () => {
    const invalidValues = [
      null,
      [],
      {},
      { schemaVersion: RUNTIME_DISPATCH_SCHEMA_VERSION, dispatchId },
      { schemaVersion: "hermes.runtime-dispatch/v2", dispatchId, runId },
      {
        schemaVersion: RUNTIME_DISPATCH_SCHEMA_VERSION,
        dispatchId: "not-a-uuid",
        runId,
      },
      {
        schemaVersion: RUNTIME_DISPATCH_SCHEMA_VERSION,
        dispatchId,
        runId: "not-a-uuid",
      },
    ];

    for (const value of invalidValues) assertStableValidationError(value);
  });

  it("rejects workspace, authorization, and secret fields", () => {
    for (const extra of [
      { workspaceId: "323e4567-e89b-12d3-a456-426614174002" },
      { providerSecret: "do-not-serialize" },
      { permissions: ["analytics.query"] },
    ]) {
      assertStableValidationError({
        schemaVersion: RUNTIME_DISPATCH_SCHEMA_VERSION,
        dispatchId,
        runId,
        ...extra,
      });
    }

    assert.throws(
      () =>
        createRuntimeDispatchEnvelope({
          dispatchId,
          runId,
          workspaceId: "323e4567-e89b-12d3-a456-426614174002",
        } as Parameters<typeof createRuntimeDispatchEnvelope>[0]),
      isStableValidationError,
    );
  });
});

function assertStableValidationError(value: unknown) {
  assert.throws(() => parseRuntimeDispatchEnvelope(value), isStableValidationError);
}

function isStableValidationError(error: unknown) {
  assert.ok(error instanceof RuntimeDispatchEnvelopeValidationError);
  assert.equal(error.code, RUNTIME_DISPATCH_ENVELOPE_VALIDATION_ERROR_CODE);
  assert.equal(error.message, "Runtime dispatch envelope is invalid.");
  return true;
}
