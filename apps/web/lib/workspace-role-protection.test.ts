import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isProtectedWorkspaceRole } from "./workspace-role-protection.js";

describe("workspace role permission protection", () => {
  it("protects only Workspace Owner permissions", () => {
    assert.equal(isProtectedWorkspaceRole({ name: "workspace-owner" }), true);
    assert.equal(isProtectedWorkspaceRole({ name: "workspace-admin" }), false);
    assert.equal(isProtectedWorkspaceRole({ name: "workspace-member" }), false);
  });
});
