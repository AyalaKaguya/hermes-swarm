import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePrincipalRoute } from "./principal-route";

describe("principal route isolation", () => {
  it("keeps tenant principals out of the platform control plane", () => {
    assert.equal(resolvePrincipalRoute("tenant", "/platform/tenants"), "/home");
    assert.equal(resolvePrincipalRoute("tenant", "/settings/tenant"), null);
  });

  it("keeps platform principals out of tenant routes", () => {
    assert.equal(
      resolvePrincipalRoute("platform", "/settings/tenant"),
      "/platform/tenants",
    );
    assert.equal(resolvePrincipalRoute("platform", "/platform/tenants"), null);
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
});
