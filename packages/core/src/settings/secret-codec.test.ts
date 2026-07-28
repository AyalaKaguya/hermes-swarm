import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptEncryptedSettingSecret,
  decryptSettingSecret,
  encryptSettingSecret,
} from "./secret-codec.js";

const keyring = Object.freeze({
  currentKey: "current-secret-material",
  currentKeyId: "current",
  previousKeys: Object.freeze({ previous: "previous-secret-material" }),
});

describe("shared setting secret codec", () => {
  it("round-trips current envelopes for API and Worker consumers", () => {
    const envelope = encryptSettingSecret("provider-key", keyring);

    assert.match(envelope, /^enc:v2:current:/);
    assert.equal(decryptSettingSecret(envelope, keyring), "provider-key");
    assert.equal(
      decryptEncryptedSettingSecret(envelope, keyring),
      "provider-key",
    );
  });

  it("keeps legacy plaintext compatibility out of the Worker boundary", () => {
    assert.equal(decryptSettingSecret("legacy-plaintext", keyring), "legacy-plaintext");
    assert.throws(
      () => decryptEncryptedSettingSecret("legacy-plaintext", keyring),
      /current envelope format/,
    );
  });
});
