import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TrustedRunContextService } from "./trusted-run-context.service.js";
import type { ClaimedRuntimeRun } from "./runtime-run.types.js";

describe("TrustedRunContextService", () => {
  it("scopes a frozen context reconstructed from the persisted claim", async () => {
    const service = new TrustedRunContextService();
    const claim = claimedRun();

    await service.run(claim, new AbortController().signal, async (context) => {
      assert.deepEqual(context.lease, {
        fencingGeneration: claim.fencingGeneration,
        runId: claim.runId,
        workspaceId: claim.workspaceId,
      });
      assert.deepEqual(service.current(), {
        attempt: claim.attempt,
        dispatchId: claim.dispatchId,
        lease: context.lease,
        leaseToken: claim.leaseToken,
        runKind: claim.runKind,
      });
      assert.equal("leaseToken" in context, false);
      assert.equal(Object.isFrozen(context), true);
      assert.equal(Object.isFrozen(context.lease), true);
    });

    assert.equal(service.current(false), undefined);
  });
});

function claimedRun(): ClaimedRuntimeRun {
  return {
    attempt: 1,
    deadlineDelayMs: null,
    dispatchId: "018f80c0-0000-7000-8000-000000000001",
    fencingGeneration: 2,
    leaseToken: "018f80c0-0000-7000-8000-000000000002",
    maxAttempts: 3,
    runId: "018f80c0-0000-7000-8000-000000000003",
    runKind: "agent.graph",
    workspaceId: "018f80c0-0000-7000-8000-000000000004",
  };
}
