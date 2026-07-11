import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { AccessScopeService } from "./access-scope.service.js";
import type { AccessRequest, ResolvedAccessDefinition } from "./access.types.js";

const definition = {
  scope: "organization",
} as ResolvedAccessDefinition;

describe("AccessScopeService tenant request scope", () => {
  const service = new AccessScopeService({} as never);

  it("resolves an organization path inside the signed-in tenant", async () => {
    assert.deepEqual(
      await service.resolve(definition, undefined, request({
        params: { organizationId: "org-1" },
      })),
      {
        organizationId: "org-1",
        scopeLevel: "organization",
        tenantId: "tenant-1",
      },
    );
  });

  it("rejects path and header organization conflicts", async () => {
    await assert.rejects(
      () =>
        service.resolve(definition, undefined, request({
          headers: { "organization-id": "org-2" },
          params: { organizationId: "org-1" },
        })),
      BadRequestException,
    );
  });

  it("rejects attempts to override the session tenant", async () => {
    await assert.rejects(
      () =>
        service.resolve(definition, undefined, request({
          headers: { "tenant-id": "tenant-2" },
          params: { organizationId: "org-1" },
        })),
      BadRequestException,
    );
  });

  it("requires both organization and department for department scope", async () => {
    assert.deepEqual(
      await service.resolve(
        definition,
        { scope: "department" },
        request({
          headers: { "organization-id": "org-1" },
          params: { departmentId: "dept-1" },
        }),
      ),
      {
        departmentId: "dept-1",
        organizationId: "org-1",
        scopeLevel: "department",
        tenantId: "tenant-1",
      },
    );
  });
});

function request(overrides: Partial<AccessRequest>): AccessRequest {
  return {
    accessPrincipal: {
      principalType: "tenant",
      tenantId: "tenant-1",
      userId: "user-1",
    },
    ...overrides,
  };
}
