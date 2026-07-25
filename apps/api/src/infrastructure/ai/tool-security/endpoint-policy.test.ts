import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertTargetMatchesApprovedEndpoint,
  isPathWithinPrefix,
  isTargetWithinApprovedEndpoint,
  normalizeApprovedEndpoint,
  normalizeApprovedEndpoints,
} from "./endpoint-policy.js";
import { ToolSecurityPolicyError } from "./tool-security.error.js";

describe("approved tool endpoints", () => {
  it("normalizes scheme, DNS host, effective port, and path prefix", () => {
    const endpoint = normalizeApprovedEndpoint(
      "  https://API.Example.COM:443/mcp///  ",
    );
    assert.deepEqual(endpoint, {
      authority: "api.example.com",
      hostname: "api.example.com",
      pathPrefix: "/mcp",
      port: 443,
      scheme: "https",
      url: "https://api.example.com/mcp",
    });
    assert.equal(Object.isFrozen(endpoint), true);

    assert.deepEqual(
      normalizeApprovedEndpoint("https://api.example.com:8443/"),
      {
        authority: "api.example.com:8443",
        hostname: "api.example.com",
        pathPrefix: "/",
        port: 8443,
        scheme: "https",
        url: "https://api.example.com:8443",
      },
    );
  });

  it("requires HTTPS unless a trusted caller explicitly enables dev HTTP", () => {
    rejectsEndpoint(
      "http://api.example.com/mcp",
      "TOOL_ENDPOINT_SCHEME_FORBIDDEN",
    );
    assert.deepEqual(
      normalizeApprovedEndpoint("http://api.example.com:80/mcp", {
        allowHttpInDevelopment: true,
      }),
      {
        authority: "api.example.com",
        hostname: "api.example.com",
        pathPrefix: "/mcp",
        port: 80,
        scheme: "http",
        url: "http://api.example.com/mcp",
      },
    );
  });

  it("rejects credentials, queries, fragments, wildcards, and ambiguous paths", () => {
    for (const value of [
      "https://user:secret@api.example.com/mcp",
      "https://@api.example.com/mcp",
      "https://api.example.com/mcp?token=secret",
      "https://api.example.com/mcp?",
      "https://api.example.com/mcp#fragment",
      "https://*.example.com/mcp",
      "https://api.example.com/mcp\\admin",
      "https://api.example.com/mcp/%2e%2e/admin",
      "https://api.example.com/mcp%2fadmin",
      "https://api.example.com/mcp/%252e%252e/admin",
      "https://api.example.com/mcp//admin",
      "https://api.example.com//attacker.example/admin",
      "https://api.example.com/mcp/..;/admin",
      "https://api.example.com/mcp/%3b/admin",
    ]) {
      assert.throws(
        () => normalizeApprovedEndpoint(value),
        ToolSecurityPolicyError,
        value,
      );
    }
  });

  it("rejects IP literals and non-public DNS names", () => {
    for (const value of [
      "https://127.0.0.1/mcp",
      "https://0x7f000001/mcp",
      "https://[::1]/mcp",
      "https://localhost/mcp",
      "https://single-label/mcp",
      "https://api.example.com./mcp",
      "https://service.internal/mcp",
      "https://metadata.google.internal/mcp",
      "https://bad_label.example.com/mcp",
    ]) {
      rejectsEndpoint(value, "TOOL_ENDPOINT_HOST_FORBIDDEN");
    }
  });

  it("deduplicates and sorts an approved endpoint set", () => {
    const endpoints = normalizeApprovedEndpoints([
      "https://z.example.com/api/",
      "https://a.example.com/api",
      "https://Z.example.com:443/api",
    ]);
    assert.deepEqual(
      endpoints.map((endpoint) => endpoint.url),
      ["https://a.example.com/api", "https://z.example.com/api"],
    );
    assert.equal(Object.isFrozen(endpoints), true);
  });
});

describe("outbound target approval boundaries", () => {
  const approved = normalizeApprovedEndpoint(
    "https://tools.example.com:8443/mcp",
  );

  it("allows the exact prefix and descendants on a slash boundary", () => {
    assert.deepEqual(
      assertTargetMatchesApprovedEndpoint(
        "https://TOOLS.example.com:8443/mcp/tools/",
        approved,
      ),
      {
        authority: "tools.example.com:8443",
        hostname: "tools.example.com",
        path: "/mcp/tools",
        port: 8443,
        query: "",
        scheme: "https",
        url: "https://tools.example.com:8443/mcp/tools",
      },
    );
    assert.equal(
      isTargetWithinApprovedEndpoint(
        "https://tools.example.com:8443/mcp",
        approved,
      ),
      true,
    );
    assert.equal(isPathWithinPrefix("/mcp/tools", "/mcp"), true);
    assert.equal(isPathWithinPrefix("/mcproxy", "/mcp"), false);
  });

  it("rejects scheme, host, effective port, and prefix bypasses", () => {
    for (const target of [
      "http://tools.example.com:8443/mcp",
      "https://tools.example.com/mcp",
      "https://tools.example.com:9443/mcp",
      "https://tools.example.com.attacker.test:8443/mcp",
      "https://tools.example.com:8443/mcproxy",
      "https://tools.example.com:8443/mcp/../admin",
    ]) {
      assert.equal(isTargetWithinApprovedEndpoint(target, approved), false, target);
    }
  });

  it("keeps concrete query parameters opt-in and always rejects fragments", () => {
    const target = "https://tools.example.com:8443/mcp?cursor=next";
    assert.equal(isTargetWithinApprovedEndpoint(target, approved), false);
    assert.equal(
      assertTargetMatchesApprovedEndpoint(target, approved, { allowQuery: true })
        .url,
      target,
    );
    assert.equal(
      isTargetWithinApprovedEndpoint(
        "https://tools.example.com:8443/mcp?cursor=next#fragment",
        approved,
        { allowQuery: true },
      ),
      false,
    );
  });

  it("requires the development override again when checking an HTTP target", () => {
    const developmentEndpoint = normalizeApprovedEndpoint(
      "http://tools.example.com/mcp",
      { allowHttpInDevelopment: true },
    );
    assert.equal(
      isTargetWithinApprovedEndpoint(
        "http://tools.example.com/mcp/tools",
        developmentEndpoint,
      ),
      false,
    );
    assert.equal(
      isTargetWithinApprovedEndpoint(
        "http://tools.example.com/mcp/tools",
        developmentEndpoint,
        { allowHttpInDevelopment: true },
      ),
      true,
    );
  });
});

function rejectsEndpoint(
  value: string,
  code: ToolSecurityPolicyError["code"],
) {
  assert.throws(
    () => normalizeApprovedEndpoint(value),
    (error: unknown) =>
      error instanceof ToolSecurityPolicyError && error.code === code,
    value,
  );
}
