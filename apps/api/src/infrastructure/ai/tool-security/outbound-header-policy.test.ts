import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isUnsafeOutboundHeaderName,
  normalizeOutboundHeaders,
} from "./outbound-header-policy.js";
import { ToolSecurityPolicyError } from "./tool-security.error.js";

describe("outbound connector header policy", () => {
  it("normalizes safe names and values into an immutable sorted record", () => {
    const headers = normalizeOutboundHeaders({
      "X-Request-ID": "  request-1  ",
      Accept: "application/json",
      "Content-Type": "application/json; charset=utf-8",
    });
    assert.deepEqual(headers, {
      accept: "application/json",
      "content-type": "application/json; charset=utf-8",
      "x-request-id": "request-1",
    });
    assert.equal(Object.isFrozen(headers), true);
    assert.deepEqual(normalizeOutboundHeaders(undefined), {});
  });

  it("rejects gateway, credential, forwarding, and hop-by-hop headers", () => {
    for (const name of [
      "Authorization",
      "Cookie",
      "Host",
      "Content-Length",
      "Connection",
      "Transfer-Encoding",
      "Proxy-Authorization",
      "Forwarded",
      "X-Forwarded-For",
      "X-Real-IP",
      "Sec-Fetch-Site",
      "X-Hermes-Workspace",
      "X-Envoy-Original-Path",
      "X-HTTP-Method-Override",
      "constructor",
    ]) {
      assert.equal(isUnsafeOutboundHeaderName(name), true, name);
      assert.throws(
        () => normalizeOutboundHeaders({ [name]: "value" }),
        (error: unknown) =>
          error instanceof ToolSecurityPolicyError &&
          error.code === "TOOL_HEADER_FORBIDDEN",
        name,
      );
    }
    assert.equal(isUnsafeOutboundHeaderName("X-Request-ID"), false);
  });

  it("rejects duplicate, malformed, multiline, and non-string values", () => {
    const cases: unknown[] = [
      { Foo: "one", fOO: "two" },
      { "bad header": "value" },
      { "x-test": "safe\r\nHost: internal" },
      { "x-test": ["one", "two"] },
      [],
      new (class HeadersInput {
        value = "test";
      })(),
    ];
    for (const value of cases) {
      assert.throws(
        () => normalizeOutboundHeaders(value),
        (error: unknown) =>
          error instanceof ToolSecurityPolicyError &&
          error.code === "TOOL_HEADER_INVALID",
      );
    }
  });

  it("enforces count and byte-size budgets without echoing values", () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: 33 }, (_, index) => [`x-test-${index}`, "value"]),
    );
    assert.throws(() => normalizeOutboundHeaders(tooMany), /32 entries/);
    const secret = "secret-value-that-must-not-be-logged";
    assert.throws(
      () => normalizeOutboundHeaders({ "x-test": secret.repeat(1_000) }),
      (error: unknown) =>
        error instanceof ToolSecurityPolicyError &&
        !error.message.includes(secret),
    );
  });
});
