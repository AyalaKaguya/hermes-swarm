import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CURRENCY_OPTIONS,
  FEATURE_SETTING_DEFINITIONS,
  PLATFORM_SETTING_KEYS,
  SECRET_SETTING_MASK,
  getSettingDefinitionByKey,
  inferSettingValueTypeFromKey,
  maskSettingValue,
  resolveSettingValueOptions,
  resolveSettingValueType,
} from "./definitions.js";

describe("setting definitions", () => {
  it("resolves known platform setting value types from definitions", () => {
    assert.equal(
      resolveSettingValueType(PLATFORM_SETTING_KEYS.allowOrganizationCreation, "string"),
      "boolean",
    );
    assert.equal(
      resolveSettingValueType(PLATFORM_SETTING_KEYS.defaultCurrency, null),
      "enum",
    );
  });

  it("uses supplied custom value types when no known definition overrides them", () => {
    assert.equal(resolveSettingValueType("custom.invoice.retries", "number"), "number");
  });

  it("infers secret value types from key tokens and common key patterns", () => {
    assert.equal(inferSettingValueTypeFromKey("mail.smtp.password"), "secret");
    assert.equal(inferSettingValueTypeFromKey("service.apiKey"), "secret");
    assert.equal(inferSettingValueTypeFromKey("display.title"), null);
  });

  it("prefers explicit value options and falls back to definition options", () => {
    const customOptions = [{ label: "Custom", value: "custom" }];

    assert.deepEqual(
      resolveSettingValueOptions(PLATFORM_SETTING_KEYS.defaultCurrency, customOptions),
      customOptions,
    );
    assert.deepEqual(
      resolveSettingValueOptions(PLATFORM_SETTING_KEYS.defaultCurrency),
      CURRENCY_OPTIONS,
    );
  });

  it("masks only persisted secret values", () => {
    assert.equal(maskSettingValue("smtp-secret", "secret"), SECRET_SETTING_MASK);
    assert.equal(maskSettingValue(null, "secret"), null);
    assert.equal(maskSettingValue("Hermes", "string"), "Hermes");
  });

  it("finds feature definitions by key", () => {
    const feature = FEATURE_SETTING_DEFINITIONS[0];

    assert.equal(getSettingDefinitionByKey(feature.key), feature);
  });
});
