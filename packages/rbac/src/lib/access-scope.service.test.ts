import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { AccessScopeService } from "./access-scope.service.js";
import type { AccessRequest, ResolvedAccessDefinition } from "./access.types.js";

describe("AccessScopeService workspace request scope", () => {
  const service = new AccessScopeService({} as never);

  it("resolves workspace scope exclusively from the signed-in session", async () => {
    assert.deepEqual(
      await service.resolve(definition("workspace"), undefined, request({})),
      {
        scopeLevel: "workspace",
        workspaceId: "workspace-1",
      },
    );
  });

  it("resolves own scope to the signed-in member by default", async () => {
    assert.deepEqual(
      await service.resolve(definition("own"), undefined, request({})),
      {
        scopeLevel: "workspace",
        targetUserId: "user-1",
        workspaceId: "workspace-1",
      },
    );
  });

  it("rejects attempts to override the session workspace", async () => {
    await assert.rejects(
      () =>
        service.resolve(
          definition("workspace"),
          undefined,
          request({ headers: { "workspace-id": "workspace-2" } }),
        ),
      BadRequestException,
    );
  });
});

function request(overrides: Partial<AccessRequest>): AccessRequest {
  return {
    accessPrincipal: {
      principalType: "workspace",
      workspaceId: "workspace-1",
      userId: "user-1",
    },
    ...overrides,
  };
}

function definition(
  scope: ResolvedAccessDefinition["scope"],
): ResolvedAccessDefinition {
  return {
    defaultRoles: [],
    description: null,
    entity: "test",
    entityLabel: "Test",
    id: `test.test.read:${scope}`,
    isDangerous: false,
    operation: "read",
    operationLabel: "Read",
    operationOrder: null,
    purpose: "test",
    purposeLabel: "Test",
    scope,
  };
}
