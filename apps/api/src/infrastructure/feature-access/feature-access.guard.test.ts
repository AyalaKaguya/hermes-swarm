import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { FeatureAccessGuard } from "./feature-access.guard.js";

describe("FeatureAccessGuard tenant context", () => {
  it("does not open a transaction when no feature is required", async () => {
    let transactionStarted = false;
    const guard = new FeatureAccessGuard(
      {} as never,
      { getAllAndOverride: () => undefined } as never,
      { transaction: async () => { transactionStarted = true; } } as never,
      {} as never,
    );
    assert.equal(await guard.canActivate(context({})), true);
    assert.equal(transactionStarted, false);
  });

  it("checks tenant feature gates in a tenant transaction", async () => {
    const queries: unknown[] = [];
    let checked = false;
    const tenantContext = {
      current: () => null,
      run: (_context: unknown, work: () => unknown) => work(),
    };
    const manager = { query: async (...args: unknown[]) => { queries.push(args); } };
    const guard = new FeatureAccessGuard(
      { isFeatureEnabled: async (_key: string, input: unknown) => { checked = true; assert.deepEqual(input, { tenantId: "tenant-a" }); return true; } } as never,
      { getAllAndOverride: () => "feature:invite:enabled" } as never,
      { transaction: async (work: (manager: unknown) => unknown) => work(manager) } as never,
      tenantContext as never,
    );
    assert.equal(
      await guard.canActivate(context({ accessPrincipal: { tenantId: "tenant-a" } })),
      true,
    );
    assert.equal(checked, true);
    assert.equal(queries.length, 1);
  });
});

function context(request: unknown) {
  return {
    getClass: () => class TestController {},
    getHandler: () => function handler() {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as never;
}
