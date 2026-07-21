import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PLATFORM_SETTING_KEYS } from "./definitions.js";
import {
  normalizeCanonicalLanguage,
  resolveRuntimePreferences,
} from "./runtime-preferences.js";

describe("runtime preferences", () => {
  it("prefers explicit user language and time zone", () => {
    const result = resolveRuntimePreferences(
      { preferredLanguage: "en-US", timeZone: "Europe/London" },
      [
        {
          name: PLATFORM_SETTING_KEYS.defaultLanguage,
          scope: "workspace",
          value: "zh-Hant",
        },
        {
          name: PLATFORM_SETTING_KEYS.defaultTimeZone,
          scope: "workspace",
          value: "Asia/Tokyo",
        },
      ],
    );

    assert.equal(result.language, "en");
    assert.equal(result.timeZone, "Europe/London");
    assert.equal(result.sources.language, "user");
    assert.equal(result.sources.timeZone, "user");
  });

  it("uses workspace and platform settings before code defaults", () => {
    const result = resolveRuntimePreferences(null, [
      {
        name: PLATFORM_SETTING_KEYS.defaultCurrency,
        scope: "workspace",
        value: "HKD",
      },
      {
        name: PLATFORM_SETTING_KEYS.defaultRegionCode,
        scope: "platform",
        value: "HK",
      },
    ]);

    assert.equal(result.currency, "HKD");
    assert.equal(result.regionCode, "HK");
    assert.equal(result.dateFormat, "YYYY-MM-DD");
    assert.equal(result.sources.currency, "workspace");
    assert.equal(result.sources.regionCode, "platform");
    assert.equal(result.sources.dateFormat, "code");
  });

  it("normalizes supported legacy language aliases", () => {
    assert.equal(normalizeCanonicalLanguage("zh-CN"), "zh-Hans");
    assert.equal(normalizeCanonicalLanguage("zh-HK"), "zh-Hant");
    assert.equal(normalizeCanonicalLanguage("en-GB"), "en");
    assert.equal(normalizeCanonicalLanguage("fr"), null);
  });
});
