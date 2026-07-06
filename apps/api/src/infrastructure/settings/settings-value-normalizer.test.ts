import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { SECRET_SETTING_MASK } from "@hermes-swarm/core";
import {
  normalizeSettingEntry,
  parseSettingsPayload,
} from "./settings-value-normalizer.js";

describe("settings payload parsing", () => {
  it("parses the explicit settings array form and trims setting names", () => {
    assert.deepEqual(
      parseSettingsPayload({
        settings: [{ name: " platform.title ", value: "Hermes" }],
      }),
      [
        {
          name: "platform.title",
          value: "Hermes",
          valueOptions: undefined,
          valueType: undefined,
        },
      ],
    );
  });

  it("parses object shorthand payloads while ignoring the settings key", () => {
    assert.deepEqual(
      parseSettingsPayload({
        "feature:email:enabled": true,
        settings: "ignored",
      }),
      [{ name: "feature:email:enabled", value: true }],
    );
  });

  it("rejects empty payloads and blank setting names", () => {
    assert.throws(() => parseSettingsPayload({}), BadRequestException);
    assert.throws(
      () => parseSettingsPayload({ settings: [{ name: " ", value: "x" }] }),
      BadRequestException,
    );
  });
});

describe("setting entry normalization", () => {
  it("serializes boolean, number, and json values by resolved type", () => {
    assert.equal(
      normalizeSettingEntry({
        name: "feature:email:enabled",
        value: true,
      }).value,
      "true",
    );
    assert.equal(
      normalizeSettingEntry({
        name: "custom.retryLimit",
        value: " 3 ",
        valueType: "number",
      }).value,
      "3",
    );
    assert.equal(
      normalizeSettingEntry({
        name: "custom.payload",
        value: { enabled: true },
        valueType: "json",
      }).value,
      "{\"enabled\":true}",
    );
  });

  it("normalizes enum options and validates enum values", () => {
    const normalized = normalizeSettingEntry({
      name: "custom.mode",
      value: "live",
      valueOptions: [{ label: " Live ", value: " live " }],
      valueType: "enum",
    });

    assert.deepEqual(normalized.valueOptions, [{ label: "Live", value: "live" }]);
    assert.equal(normalized.value, "live");
    assert.throws(
      () =>
        normalizeSettingEntry({
          name: "custom.mode",
          value: "draft",
          valueOptions: [{ label: "Live", value: "live" }],
          valueType: "enum",
        }),
      BadRequestException,
    );
  });

  it("preserves an existing secret when the masked value is submitted", () => {
    assert.equal(
      normalizeSettingEntry(
        {
          name: "mail.smtp.password",
          value: SECRET_SETTING_MASK,
        },
        [{ value: "current-secret", valueType: "secret" }],
      ).value,
      "current-secret",
    );
  });

  it("rejects invalid primitive formats", () => {
    assert.throws(
      () =>
        normalizeSettingEntry({
          name: "feature:email:enabled",
          value: "yes",
        }),
      BadRequestException,
    );
    assert.throws(
      () =>
        normalizeSettingEntry({
          name: "custom.payload",
          value: "{broken",
          valueType: "json",
        }),
      BadRequestException,
    );
  });
});
