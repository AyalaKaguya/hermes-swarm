import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasPageAccess, hasPermission } from "./access-control";
import type { ResolvedSession } from "./session";

const principal = (permissions: string[]): ResolvedSession =>
  ({ permissions }) as ResolvedSession;

describe("web access control", () => {
  it("denies missing principals", () => {
    assert.equal(hasPermission(null, "page.settings.account.access:own"), false);
  });

  it("supports any and all permission modes", () => {
    const user = principal(["alpha", "beta"]);

    assert.equal(hasPermission(user, ["missing", "alpha"]), true);
    assert.equal(hasPermission(user, ["alpha", "beta"], { mode: "all" }), true);
    assert.equal(hasPermission(user, ["alpha", "missing"], { mode: "all" }), false);
  });

  it("allows empty permission requirements for an authenticated principal", () => {
    assert.equal(hasPermission(principal([]), []), true);
  });

  it("checks page access through page definition permissions", () => {
    assert.equal(
      hasPageAccess(
        principal(["page.settings.roles.access:organization"]),
        "settings.roles",
      ),
      true,
    );
    assert.equal(hasPageAccess(principal([]), "settings.roles"), false);
    assert.equal(hasPageAccess(principal([]), "missing.page"), false);
  });
});
