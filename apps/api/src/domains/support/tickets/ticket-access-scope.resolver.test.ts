import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import { TicketAccessScopeResolver } from "./ticket-access-scope.resolver.js";

test("ticket authorization resolves an explicit organization boundary", () => {
  const resolver = new TicketAccessScopeResolver();
  assert.deepEqual(resolver.resolve({
    definition: {} as never,
    request: { body: { sourceOrganizationId: "org-a" } },
  }), {
    organizationId: "org-a",
    scopeLevel: "organization",
  });
  assert.throws(
    () => resolver.resolve({ definition: {} as never, request: {} }),
    BadRequestException,
  );
});
