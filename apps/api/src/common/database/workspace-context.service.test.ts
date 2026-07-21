import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { EntityManager } from "typeorm";
import { WorkspaceContextService } from "./workspace-context.service.js";
import { resolveWorkspaceRequestScope } from "./workspace-transaction.interceptor.js";
import { WORKSPACE_DATABASE_GUCS } from "./workspace-database.constants.js";

describe("workspace database context", () => {
  it("uses only workspace transaction-local GUCs", () => {
    assert.deepEqual(WORKSPACE_DATABASE_GUCS, {
      scopeLevel: "app.scope_level",
      workspaceId: "app.workspace_id",
    });
  });

  it("keeps workspace managers isolated across asynchronous work", async () => {
    const service = new WorkspaceContextService();
    const manager = {} as EntityManager;
    const result = await service.run(
      { manager, scopeLevel: "workspace", workspaceId: "workspace-a" },
      async () => {
        await Promise.resolve();
        return service.current();
      },
    );
    assert.equal(result?.workspaceId, "workspace-a");
    assert.equal(result?.manager, manager);
    assert.equal(service.current(false), null);
  });

  it("derives scope only from authorized access metadata", () => {
    assert.deepEqual(
      resolveWorkspaceRequestScope({ headers: { "workspace-id": "spoofed" } }),
      { scopeLevel: "workspace" },
    );
    assert.deepEqual(
      resolveWorkspaceRequestScope({
        accessAudit: { scope: { scopeLevel: "own" } },
      }),
      { scopeLevel: "own" },
    );
  });
});
