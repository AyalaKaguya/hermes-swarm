import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeEffectiveTenantSettings } from "./effective-settings.js";

describe("workspace settings", () => {
  it("resolves platform defaults through tenant overrides", () => {
    const result = mergeEffectiveTenantSettings(
      [{ id: "tenant-setting", name: "locale", value: "zh-CN" }],
      [{ id: "platform-setting", name: "locale", value: "en" }],
      "tenant-a",
    );
    assert.equal(result[0]?.value, "zh-CN");
    assert.equal(result[0]?.defaultValue, "en");
    assert.equal(result[0]?.scope, "tenant");
  });

  it("identifies inherited platform values without an organization layer", () => {
    const result = mergeEffectiveTenantSettings(
      [],
      [{ id: "platform", name: "language", value: "en" }],
      "tenant-a",
    );
    assert.equal(result[0]?.value, "en");
    assert.equal(result[0]?.scope, "platform");
    assert.equal(result[0]?.isOverridden, false);
  });
});
