import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FeatureAccessService } from "./feature-access.service.js";

describe("FeatureAccessService", () => {
  it("resolves platform features from the platform setting", async () => {
    const calls: string[] = [];
    const service = createService(calls);
    assert.equal(await service.isFeatureEnabled("system:maintenance:enabled"), false);
    assert.deepEqual(calls, ["platform:system:maintenance:enabled"]);
  });

  it("resolves workspace features through the workspace override chain", async () => {
    const calls: string[] = [];
    const service = createService(calls);
    assert.equal(
      await service.isFeatureEnabled("feature:password-reset:enabled"),
      true,
    );
    assert.deepEqual(calls, ["workspace:workspace-1:feature:password-reset:enabled"]);
  });

  it("resolves email features directly at workspace scope", async () => {
    const calls: string[] = [];
    const service = createService(calls);
    assert.equal(
      await service.isFeatureEnabled("feature:email:enabled"),
      true,
    );
    assert.deepEqual(calls, ["workspace:workspace-1:feature:email:enabled"]);
  });
});

function createService(calls: string[]) {
  const settings = {
    async getPlatformValue(name: string) {
      calls.push(`platform:${name}`);
      return "false";
    },
    async getWorkspaceValue(workspaceId: string, name: string) {
      calls.push(`workspace:${workspaceId}:${name}`);
      return "true";
    },
  };
  const workspaceContext = {
    current: () => ({ workspaceId: "workspace-1" }),
  };
  return new FeatureAccessService(settings as never, workspaceContext as never);
}
