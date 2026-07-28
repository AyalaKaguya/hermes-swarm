import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isAiNavigationEnabled } from "./ai-navigation";

describe("AI navigation", () => {
  it("is visible only when the platform AI feature is enabled", () => {
    assert.equal(isAiNavigationEnabled([]), false);
    assert.equal(
      isAiNavigationEnabled([
        { name: "feature:ai:enabled", value: "false" },
      ]),
      false,
    );
    assert.equal(
      isAiNavigationEnabled([
        { name: "feature:ai:enabled", value: "true" },
      ]),
      true,
    );
  });
});
