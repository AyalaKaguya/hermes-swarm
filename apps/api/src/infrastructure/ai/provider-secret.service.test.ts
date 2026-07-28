import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  PROVIDER_SECRET_MASK,
  ProviderSecretService,
} from "./provider-secret.service.js";

const secretId = "11111111-1111-4111-8111-111111111111";

describe("ProviderSecretService", () => {
  it("uses randomized authenticated encryption without exposing plaintext", () => {
    const service = providerSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
    });
    const first = service.encrypt("provider-api-key");
    const second = service.encrypt("provider-api-key");

    assert.notEqual(first, second);
    assert.match(first, /^enc:v2:current:/);
    assert.equal(first.includes("provider-api-key"), false);
    assert.equal(service.decrypt(first), "provider-api-key");
  });

  it("rotates a previous-key envelope onto the current key", () => {
    const previous = providerSecrets({
      currentKey: "previous-master-key",
      currentKeyId: "previous",
    }).encrypt("provider-api-key");
    const current = providerSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
      previousKeys: { previous: "previous-master-key" },
    });

    const rotated = current.rotate(previous);
    assert.match(rotated, /^enc:v2:current:/);
    assert.notEqual(rotated, previous);
    assert.equal(current.decrypt(rotated), "provider-api-key");
  });

  it("returns strict masked metadata without ciphertext or plaintext", () => {
    const service = providerSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
    });
    const envelope = service.encrypt("provider-api-key");
    const metadata = service.metadata({
      id: secretId,
      revision: 3,
      updatedAt: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.deepEqual(metadata, {
      configured: true,
      id: secretId,
      mask: PROVIDER_SECRET_MASK,
      revision: 3,
      updatedAt: "2026-07-25T10:00:00.000Z",
    });
    const serialized = JSON.stringify(metadata);
    assert.equal(serialized.includes("provider-api-key"), false);
    assert.equal(serialized.includes(envelope), false);
    assert.deepEqual(service.metadata({
      envelope: null,
      id: null,
      revision: 0,
      updatedAt: null,
    }), {
      configured: false,
      id: null,
      mask: null,
      revision: 0,
      updatedAt: null,
    });
  });

  it("fails closed for inconsistent metadata and unsafe secret values", () => {
    const service = providerSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
    });
    assert.throws(() => service.encrypt(" \t "), /Provider secret is invalid/);
    assert.throws(() => service.encrypt("key\nvalue"), /Provider secret is invalid/);
    assert.throws(() => service.metadata({
      envelope: service.encrypt("provider-api-key"),
      id: null,
      revision: 0,
      updatedAt: null,
    }), /Provider secret metadata is inconsistent/);
  });
});

function providerSecrets(input: {
  currentKey: string;
  currentKeyId: string;
  previousKeys?: Record<string, string>;
}) {
  return new ProviderSecretService(config({
    "settings.encryptionKey": input.currentKey,
    "settings.encryptionKeyId": input.currentKeyId,
    "settings.previousEncryptionKeys": input.previousKeys ?? {},
  }) as never);
}

function config(values: Record<string, unknown>) {
  return {
    get(name: string, fallback?: unknown) {
      return values[name] ?? fallback;
    },
  };
}
