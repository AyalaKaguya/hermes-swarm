import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { lastValueFrom, of } from "rxjs";
import { WorkspaceContextService } from "./workspace-context.service.js";
import {
  resolveWorkspaceRequestScope,
  WorkspaceContextInterceptor,
} from "./workspace-context.interceptor.js";

describe("workspace database context", () => {
  it("keeps workspace scope isolated across asynchronous work", async () => {
    const service = new WorkspaceContextService();
    const result = await service.run(
      { scopeLevel: "workspace", workspaceId: "workspace-a" },
      async () => {
        await Promise.resolve();
        return service.current();
      },
    );
    assert.equal(result?.workspaceId, "workspace-a");
    assert.equal("manager" in (result ?? {}), false);
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

  it("uses the authenticated principal rather than a forged workspace header", async () => {
    const service = new WorkspaceContextService();
    const interceptor = new WorkspaceContextInterceptor(service);
    const request = {
      accessPrincipal: {
        principalType: "workspace" as const,
        workspaceId: "workspace-trusted",
      },
      headers: { "workspace-id": "workspace-forged" },
    };
    const result = await lastValueFrom(
      interceptor.intercept(
        {
          switchToHttp: () => ({ getRequest: () => request }),
        } as never,
        {
          handle: () => of(service.current().workspaceId),
        } as never,
      ),
    );

    assert.equal(result, "workspace-trusted");
  });
});
