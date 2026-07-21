import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveLoginRoute, resolvePrincipalRoute } from "./principal-route";

describe("principal route isolation", () => {
  it("keeps workspace principals out of the platform control plane", () => {
    assert.equal(resolvePrincipalRoute("workspace", "/platform/workspaces"), "/home");
    assert.equal(resolvePrincipalRoute("workspace", "/settings/workspace"), null);
  });

  it("keeps platform principals out of workspace routes", () => {
    assert.equal(
      resolvePrincipalRoute("platform", "/settings/workspace"),
      "/platform",
    );
    assert.equal(resolvePrincipalRoute("platform", "/platform/workspaces"), null);
  });

  it("redirects legacy platform settings routes", () => {
    assert.equal(
      resolvePrincipalRoute("platform", "/settings/platform"),
      "/platform/settings",
    );
    assert.equal(
      resolvePrincipalRoute("platform", "/settings/platform-email-templates"),
      "/platform/email-templates",
    );
  });

  it("uses the matching login surface for unauthenticated routes", () => {
    assert.equal(
      resolveLoginRoute("/platform/settings/localization"),
      "/login?context=platform&next=%2Fplatform%2Fsettings%2Flocalization",
    );
    assert.equal(resolveLoginRoute("/settings/workspace/localization"), "/login");
  });
});
