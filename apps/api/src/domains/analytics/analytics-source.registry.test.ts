import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";
import { DeterministicFakeAnalyticsAdapter } from "./testing/deterministic-fake-analytics.adapter.js";

describe("AnalyticsSourceRegistry", () => {
  it("registers immutable source metadata and supports ownership-safe cleanup", () => {
    const registry = new AnalyticsSourceRegistry();
    const adapter = new DeterministicFakeAnalyticsAdapter();
    const unregister = registry.register({
      adapter,
      policyRevision: "policy-v1",
      requiredPermissions: ["analytics.query:workspace", "analytics.query:workspace"],
      sourceKey: "support.tickets",
    });

    assert.deepEqual(registry.resolve("support.tickets")?.requiredPermissions, [
      "analytics.query:workspace",
    ]);
    assert.throws(
      () =>
        registry.register({
          adapter,
          policyRevision: "policy-v2",
          requiredPermissions: ["analytics.query:workspace"],
          sourceKey: "support.tickets",
        }),
      /already registered/,
    );

    unregister();
    assert.equal(registry.resolve("support.tickets"), null);
  });

  it("rejects ambiguous keys and fail-open registrations", () => {
    const registry = new AnalyticsSourceRegistry();
    const adapter = new DeterministicFakeAnalyticsAdapter();

    assert.throws(
      () =>
        registry.register({
          adapter,
          policyRevision: "v1",
          requiredPermissions: [],
          sourceKey: "support.tickets",
        }),
      /must declare a permission/,
    );
    assert.throws(
      () =>
        registry.register({
          adapter,
          policyRevision: "v1",
          requiredPermissions: ["analytics.query:workspace"],
          sourceKey: "Support Tickets",
        }),
      /Invalid analytics source key/,
    );
  });
});
