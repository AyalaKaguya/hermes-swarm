import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mergeEffectiveWorkspaceSettings } from "./effective-settings.js";

describe("workspace settings", () => {
  it("resolves platform defaults through workspace overrides", () => {
    const result = mergeEffectiveWorkspaceSettings(
      [{ id: "workspace-setting", name: "locale", value: "zh-CN" }],
      [{ id: "platform-setting", name: "locale", value: "en" }],
      "workspace-a",
    );
    assert.equal(result[0]?.value, "zh-CN");
    assert.equal(result[0]?.defaultValue, "en");
    assert.equal(result[0]?.scope, "workspace");
  });

  it("identifies inherited platform values at workspace scope", () => {
    const result = mergeEffectiveWorkspaceSettings(
      [],
      [{ id: "platform", name: "language", value: "en" }],
      "workspace-a",
    );
    assert.equal(result[0]?.value, "en");
    assert.equal(result[0]?.scope, "platform");
    assert.equal(result[0]?.isOverridden, false);
  });

  it("treats workspace-only parameters as editable custom values", () => {
    const result = mergeEffectiveWorkspaceSettings(
      [{
        id: "workspace-secret",
        name: "DATABASE_PASSWORD",
        value: "database-password",
        valueType: "secret",
      }],
      [],
      "workspace-a",
    );

    assert.equal(result[0]?.isCustom, true);
    assert.equal(result[0]?.isEditable, true);
    assert.equal(result[0]?.isOrphaned, false);
    assert.equal(result[0]?.value, "********");
  });
});
