import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAnalyticsNavigationEnabled } from "./analytics-navigation";

describe("analytics navigation", () => {
  it("stays hidden when the workspace feature is absent or disabled", () => {
    assert.equal(isAnalyticsNavigationEnabled([]), false);
    assert.equal(
      isAnalyticsNavigationEnabled([
        { name: "feature:analytics:enabled", value: "false" },
      ]),
      false,
    );
  });

  it("is visible only when the effective workspace feature is enabled", () => {
    assert.equal(
      isAnalyticsNavigationEnabled([
        { name: "feature:analytics:enabled", value: "true" },
      ]),
      true,
    );
    assert.equal(
      isAnalyticsNavigationEnabled([
        { name: "feature:analytics:enabled", value: "TRUE" },
      ]),
      false,
    );
  });
});
