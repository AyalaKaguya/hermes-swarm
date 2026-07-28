import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TOOL_CONNECTION_SECRET_MASK } from "@hermes-swarm/api-contracts/ai";
import {
  ToolConnectionSecretService,
  type ToolConnectionSecretEnvelope,
} from "./tool-connection-secret.service.js";
import { encryptSettingSecret } from "../settings/settings-secret-codec.js";

const secretId = "11111111-1111-4111-8111-111111111111";

describe("ToolConnectionSecretService", () => {
  it("uses randomized authenticated encryption without exposing credentials", () => {
    const service = connectionSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
    });
    const first = service.encrypt("Bearer connection credential");
    const second = service.encrypt("Bearer connection credential");

    assert.notEqual(first, second);
    assert.match(first, /^enc:v2:current:/);
    assert.equal(first.includes("Bearer connection credential"), false);
    assert.equal(service.decrypt(first), "Bearer connection credential");
  });

  it("returns a branded envelope and rotates previous keys", () => {
    const previous = connectionSecrets({
      currentKey: "previous-master-key",
      currentKeyId: "previous",
    }).encrypt("connection-api-key");
    const current = connectionSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
      previousKeys: { previous: "previous-master-key" },
    });

    const rotated: ToolConnectionSecretEnvelope = current.rotate(previous);
    assert.match(rotated, /^enc:v2:current:/);
    assert.notEqual(rotated, previous);
    assert.equal(current.decrypt(rotated), "connection-api-key");
  });

  it("rejects plaintext and legacy envelopes and validates decrypted credentials", () => {
    const keyring = {
      currentKey: "current-master-key",
      currentKeyId: "current",
    };
    const service = connectionSecrets(keyring);

    assert.throws(
      () => service.decrypt("plaintext-connection-api-key"),
      /must use enc:v2/,
    );
    assert.throws(
      () => service.decrypt("enc:v1:iv:ciphertext:tag"),
      /must use enc:v2/,
    );

    const invalidCredentialEnvelope = encryptSettingSecret(
      "key\nvalue",
      keyring,
    );
    assert.throws(
      () => service.decrypt(invalidCredentialEnvelope),
      /Tool connection secret is invalid/,
    );
  });

  it("returns contract-compatible write-only metadata", () => {
    const service = connectionSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
    });
    const envelope = service.encrypt("connection-api-key");
    const metadata = service.metadata({
      id: secretId,
      revision: 3,
      updatedAt: new Date("2026-07-25T10:00:00.000Z"),
    });

    assert.deepEqual(metadata, {
      configured: true,
      id: secretId,
      mask: TOOL_CONNECTION_SECRET_MASK,
      revision: 3,
      updatedAt: "2026-07-25T10:00:00.000Z",
    });
    const serialized = JSON.stringify(metadata);
    assert.equal(serialized.includes("connection-api-key"), false);
    assert.equal(serialized.includes(envelope), false);
    assert.deepEqual(
      service.metadata({
        envelope: null,
        id: null,
        revision: 0,
        updatedAt: null,
      }),
      {
        configured: false,
        id: null,
        mask: null,
        revision: 0,
        updatedAt: null,
      },
    );
  });

  it("validates UTF-8 byte length, whitespace, and control characters", () => {
    const service = connectionSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
    });

    assert.doesNotThrow(() => service.encrypt("a".repeat(8_192)));
    assert.throws(
      () => service.encrypt("密".repeat(2_731)),
      /Tool connection secret is invalid/,
    );
    assert.throws(
      () => service.encrypt("密钥"),
      /Tool connection secret is invalid/,
    );
    assert.throws(
      () => service.encrypt(" \t "),
      /Tool connection secret is invalid/,
    );
    assert.throws(
      () => service.encrypt("key\nvalue"),
      /Tool connection secret is invalid/,
    );
  });

  it("fails closed for missing keyrings and inconsistent metadata", () => {
    assert.throws(
      () => new ToolConnectionSecretService(config({}) as never),
      /encryption keyring is not configured/,
    );

    const service = connectionSecrets({
      currentKey: "current-master-key",
      currentKeyId: "current",
    });
    assert.throws(
      () =>
        service.metadata({
          envelope: service.encrypt("connection-api-key"),
          id: null,
          revision: 0,
          updatedAt: null,
        }),
      /Tool connection secret metadata is inconsistent/,
    );
    assert.throws(
      () =>
        service.metadata({
          id: secretId,
          revision: 0,
          updatedAt: new Date("2026-07-25T10:00:00.000Z"),
        }),
      /Tool connection secret metadata is inconsistent/,
    );
  });
});

function connectionSecrets(input: {
  currentKey: string;
  currentKeyId: string;
  previousKeys?: Record<string, string>;
}) {
  return new ToolConnectionSecretService(
    config({
      "settings.encryptionKey": input.currentKey,
      "settings.encryptionKeyId": input.currentKeyId,
      "settings.previousEncryptionKeys": input.previousKeys ?? {},
    }) as never,
  );
}

function config(values: Record<string, unknown>) {
  return {
    get(name: string, fallback?: unknown) {
      return values[name] ?? fallback;
    },
  };
}
