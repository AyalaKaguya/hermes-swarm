import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveClientIp,
  validateTrustedProxyCidrs,
} from "./client-ip.js";

describe("client IP resolution", () => {
  it("uses the direct peer and ignores spoofed headers from untrusted peers", () => {
    assert.equal(
      resolveClientIp(
        {
          headers: {
            forwarded: "for=198.51.100.20",
            "x-forwarded-for": "203.0.113.10",
          },
          socket: { remoteAddress: "192.0.2.50" },
        },
        { trustedProxyCidrs: ["10.0.0.0/8"] },
      ),
      "192.0.2.50",
    );
  });

  it("walks X-Forwarded-For from the trusted edge toward the client", () => {
    assert.equal(
      resolveClientIp(
        {
          headers: {
            "x-forwarded-for": "198.51.100.8, 203.0.113.20, 10.1.0.8",
          },
          socket: { remoteAddress: "10.1.0.9" },
        },
        { trustedProxyCidrs: ["10.0.0.0/8", "203.0.113.0/24"] },
      ),
      "198.51.100.8",
    );
  });

  it("supports RFC Forwarded values with quoted IPv6 addresses and ports", () => {
    assert.equal(
      resolveClientIp(
        {
          headers: {
            forwarded:
              'for="[2001:db8:85a3::8a2e:370:7334]:4711";proto=https, for=10.0.0.4',
          },
          socket: { remoteAddress: "::ffff:10.0.0.5" },
        },
        { trustedProxyCidrs: ["10.0.0.0/8"] },
      ),
      "2001:db8:85a3::8a2e:370:7334",
    );
  });

  it("supports common CDN single-value client IP headers", () => {
    const request = {
      headers: { "cf-connecting-ip": "203.0.113.42" },
      socket: { remoteAddress: "10.0.0.2" },
    };
    assert.equal(
      resolveClientIp(request, { trustedProxyCidrs: ["10.0.0.0/8"] }),
      "203.0.113.42",
    );
  });

  it("normalizes IPv4-mapped socket addresses and accepts exact proxy IPs", () => {
    assert.equal(
      resolveClientIp(
        {
          headers: { "true-client-ip": "198.51.100.12:443" },
          socket: { remoteAddress: "::ffff:127.0.0.1" },
        },
        { trustedProxyCidrs: ["127.0.0.1"] },
      ),
      "198.51.100.12",
    );
  });

  it("falls back to the trusted peer when forwarding values are malformed", () => {
    assert.equal(
      resolveClientIp(
        {
          headers: {
            forwarded: "for=unknown",
            "x-forwarded-for": "_hidden, not-an-ip",
          },
          socket: { remoteAddress: "10.0.0.2" },
        },
        { trustedProxyCidrs: ["10.0.0.0/8"] },
      ),
      "10.0.0.2",
    );
  });

  it("validates trusted proxy CIDR configuration", () => {
    assert.doesNotThrow(() =>
      validateTrustedProxyCidrs("127.0.0.1,10.0.0.0/8,2001:db8::/32"),
    );
    assert.throws(
      () => validateTrustedProxyCidrs("10.0.0.0/99"),
      /Invalid trusted proxy CIDR/,
    );
  });
});
