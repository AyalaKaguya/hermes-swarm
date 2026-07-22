import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FeatureAccessGuard } from "./feature-access.guard.js";

describe("FeatureAccessGuard workspace context", () => {
  it("does not initialize workspace context when no feature is required", async () => {
    let contextStarted = false;
    const guard = new FeatureAccessGuard(
      {} as never,
      { getAllAndOverride: () => undefined } as never,
      {
        current: () => null,
        run: () => {
          contextStarted = true;
        },
      } as never,
    );
    assert.equal(await guard.canActivate(context({})), true);
    assert.equal(contextStarted, false);
  });

  it("checks workspace feature gates in a lightweight trusted workspace context", async () => {
    const contexts: unknown[] = [];
    let checked = false;
    const workspaceContext = {
      current: () => null,
      run: (scope: unknown, work: () => unknown) => {
        contexts.push(scope);
        return work();
      },
    };
    const guard = new FeatureAccessGuard(
      { isFeatureEnabled: async (_key: string, input: unknown) => { checked = true; assert.deepEqual(input, { workspaceId: "workspace-a" }); return true; } } as never,
      { getAllAndOverride: () => "feature:invite:enabled" } as never,
      workspaceContext as never,
    );
    assert.equal(
      await guard.canActivate(context({ accessPrincipal: { workspaceId: "workspace-a" } })),
      true,
    );
    assert.equal(checked, true);
    assert.deepEqual(contexts, [{ scopeLevel: "workspace", workspaceId: "workspace-a" }]);
  });
});

function context(request: unknown) {
  return {
    getClass: () => class TestController {},
    getHandler: () => function handler() {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}
