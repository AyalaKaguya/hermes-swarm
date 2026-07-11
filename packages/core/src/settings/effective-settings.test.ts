import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeEffectiveHierarchicalSettings,
  mergeEffectiveTenantSettings,
} from "./effective-settings.js";

describe("hierarchical settings", () => {
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

  it("resolves organization, tenant and platform precedence", () => {
    const result = mergeEffectiveHierarchicalSettings(
      [{ id: "org", name: "timezone", value: "Asia/Hong_Kong" }],
      [{ id: "tenant", name: "timezone", value: "Asia/Shanghai" }],
      [{ id: "platform", name: "timezone", value: "UTC" }],
      "tenant-a",
      "org-a",
    );
    assert.equal(result[0]?.value, "Asia/Hong_Kong");
    assert.equal(result[0]?.defaultValue, "Asia/Shanghai");
    assert.equal(result[0]?.scope, "organization");
  });

  it("identifies inherited tenant values in organization projections", () => {
    const result = mergeEffectiveHierarchicalSettings(
      [],
      [{ id: "tenant", name: "language", value: "zh-Hans" }],
      [{ id: "platform", name: "language", value: "en" }],
      "tenant-a",
      "org-a",
    );
    assert.equal(result[0]?.value, "zh-Hans");
    assert.equal(result[0]?.scope, "tenant");
    assert.equal(result[0]?.isOverridden, false);
  });
});
