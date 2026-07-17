import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RuntimePreferences } from "@hermes-swarm/core/settings";
import {
  formatRuntimeCurrency,
  formatRuntimeDate,
  formatRuntimeDateTime,
} from "./runtime-format.js";

const preferences: RuntimePreferences = {
  currency: "HKD",
  dateFormat: "DD/MM/YYYY",
  language: "en",
  regionCode: "HK",
  sources: {
    currency: "tenant",
    dateFormat: "tenant",
    language: "user",
    regionCode: "tenant",
    timeZone: "tenant",
  },
  timeZone: "Asia/Hong_Kong",
};

describe("runtime formatting", () => {
  it("formats a cross-day timestamp in the effective time zone", () => {
    assert.equal(formatRuntimeDate("2026-07-16T18:30:00Z", preferences), "17/07/2026");
    assert.match(
      formatRuntimeDateTime("2026-07-16T18:30:00Z", preferences),
      /^17\/07\/2026 02:30/,
    );
  });

  it("formats currency with the effective currency and region", () => {
    assert.match(formatRuntimeCurrency(1234.56, preferences), /1,234\.56/);
  });
});
