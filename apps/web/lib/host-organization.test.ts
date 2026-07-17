import assert from "node:assert/strict";
import test from "node:test";
import { resolveHostOrganizationIdFromPrincipal } from "./host-organization";

test("host routing never selects an organization", () => {
  assert.equal(
    resolveHostOrganizationIdFromPrincipal(
      { principalType: "tenant" } as never,
      "organization.example.com",
    ),
    null,
  );
});
