import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptSettingSecret,
  encryptSettingSecret,
  isEncryptedSettingSecret,
} from "./settings-secret-codec.js";

describe("settings secret codec", () => {
  it("encrypts secret values with a randomized authenticated envelope", () => {
    const first = encryptSettingSecret("database-password", "master-key");
    const second = encryptSettingSecret("database-password", "master-key");

    assert.notEqual(first, second);
    assert.equal(isEncryptedSettingSecret(first), true);
    assert.equal(
      decryptSettingSecret(first, "master-key"),
      "database-password",
    );
  });

  it("keeps legacy plaintext readable until it is saved again", () => {
    assert.equal(
      decryptSettingSecret("legacy-plaintext", "master-key"),
      "legacy-plaintext",
    );
  });

  it("rejects a wrong encryption key", () => {
    const encrypted = encryptSettingSecret("database-password", "master-key");
    assert.throws(() => decryptSettingSecret(encrypted, "wrong-key"));
  });

  it("reads the previous key by key ID and writes the current v2 envelope", () => {
    const previous = encryptSettingSecret("database-password", {
      currentKey: "previous-master-key",
      currentKeyId: "previous",
    });
    const keyring = {
      currentKey: "current-master-key",
      currentKeyId: "current",
      previousKeys: { previous: "previous-master-key" },
    };

    assert.match(previous, /^enc:v2:previous:/);
    assert.equal(decryptSettingSecret(previous, keyring), "database-password");
    assert.match(
      encryptSettingSecret(decryptSettingSecret(previous, keyring), keyring),
      /^enc:v2:current:/,
    );
  });
});
