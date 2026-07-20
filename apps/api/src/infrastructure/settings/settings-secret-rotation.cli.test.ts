import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptSettingSecret,
  encryptSettingSecret,
} from "./settings-secret-codec.js";
import { rotateSettingSecrets } from "./settings-secret-rotation.cli.js";

describe("settings secret rotation task", () => {
  it("re-encrypts old-key values transactionally without exposing plaintext", async () => {
    const oldValue = encryptSettingSecret("database-password", {
      currentKey: "old-master-key",
      currentKeyId: "old",
    });
    const updates: unknown[][] = [];
    const manager = {
      query: async (sql: string, parameters?: unknown[]) => {
        if (sql.startsWith("SELECT") && sql.includes("platform_settings")) {
          return [{ id: "setting-1", value: oldValue }];
        }
        if (sql.startsWith("SELECT")) return [];
        updates.push(parameters ?? []);
        return [];
      },
    };
    let transactions = 0;
    const result = await rotateSettingSecrets(
      {
        transaction: async (work: any) => {
          transactions += 1;
          return work(manager);
        },
      } as any,
      {
        currentKey: "new-master-key",
        currentKeyId: "new",
        previousKeys: { old: "old-master-key" },
      },
    );

    assert.deepEqual(result, { failed: 0, rotated: 1, skipped: 0 });
    assert.equal(transactions, 1);
    assert.equal(updates.length, 1);
    assert.equal(String(updates[0][0]).includes("database-password"), false);
    assert.equal(
      decryptSettingSecret(String(updates[0][0]), {
        currentKey: "new-master-key",
        currentKeyId: "new",
      }),
      "database-password",
    );
  });
});
