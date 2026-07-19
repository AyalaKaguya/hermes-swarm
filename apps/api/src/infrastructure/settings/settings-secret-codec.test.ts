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
});
