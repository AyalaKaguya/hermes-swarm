import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProtectedTenantRole } from "./tenant-role-protection.js";

describe("tenant role permission protection", () => {
  it("protects only Tenant Owner permissions", () => {
    assert.equal(isProtectedTenantRole({ name: "tenant-owner" }), true);
    assert.equal(isProtectedTenantRole({ name: "tenant-admin" }), false);
    assert.equal(isProtectedTenantRole({ name: "tenant-member" }), false);
  });
});
