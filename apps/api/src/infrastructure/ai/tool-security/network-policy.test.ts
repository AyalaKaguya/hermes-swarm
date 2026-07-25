import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  assertPublicNetworkAddress,
  assertPublicNetworkAddresses,
  classifyNetworkAddress,
  isPublicNetworkAddress,
  type NetworkAddressKind,
} from "./network-policy.js";
import { ToolSecurityPolicyError } from "./tool-security.error.js";

describe("outbound network address policy", () => {
  it("blocks private, loopback, link-local, multicast, and other special IPv4", () => {
    const cases: Array<[string, NetworkAddressKind]> = [
      ["0.0.0.0", "unspecified"],
      ["10.20.30.40", "private"],
      ["100.64.0.1", "shared"],
      ["127.0.0.1", "loopback"],
      ["169.254.169.254", "link-local"],
      ["172.31.255.255", "private"],
      ["192.168.1.1", "private"],
      ["192.0.2.1", "documentation"],
      ["198.18.0.1", "benchmark"],
      ["198.51.100.2", "documentation"],
      ["203.0.113.3", "documentation"],
      ["224.0.0.1", "multicast"],
      ["255.255.255.255", "reserved"],
    ];
    for (const [address, kind] of cases) {
      const result = classifyNetworkAddress(address);
      assert.equal(result.kind, kind, address);
      assert.equal(result.public, false, address);
      assert.equal(isPublicNetworkAddress(address), false, address);
      assert.throws(
        () => assertPublicNetworkAddress(address),
        (error: unknown) =>
          error instanceof ToolSecurityPolicyError &&
          error.code === "TOOL_NETWORK_ADDRESS_FORBIDDEN",
        address,
      );
    }
  });

  it("allows ordinary public IPv4 addresses", () => {
    assert.deepEqual(assertPublicNetworkAddress("1.1.1.1"), {
      address: "1.1.1.1",
      family: 4,
      kind: "public",
      public: true,
    });
    assert.equal(isPublicNetworkAddress("93.184.216.34"), true);
  });

  it("blocks special IPv6 ranges and private IPv4 mappings", () => {
    const cases: Array<[string, NetworkAddressKind]> = [
      ["::", "unspecified"],
      ["::1", "loopback"],
      ["fc00::1", "private"],
      ["fd12:3456::1", "private"],
      ["fe80::1", "link-local"],
      ["ff02::1", "multicast"],
      ["fec0::1", "reserved"],
      ["2001:db8::1", "documentation"],
      ["3fff::1", "documentation"],
      ["2001::1", "reserved"],
      ["2002:7f00:1::", "reserved"],
      ["::ffff:127.0.0.1", "loopback"],
      ["::ffff:10.0.0.1", "private"],
      ["64:ff9b::7f00:1", "loopback"],
    ];
    for (const [address, kind] of cases) {
      const result = classifyNetworkAddress(address);
      assert.equal(result.kind, kind, address);
      assert.equal(result.public, false, address);
    }
  });

  it("allows public global, mapped, and well-known NAT64 IPv6 addresses", () => {
    assert.deepEqual(assertPublicNetworkAddress("2606:4700:4700::1111"), {
      address: "2606:4700:4700::1111",
      family: 6,
      kind: "public",
      public: true,
    });
    assert.equal(isPublicNetworkAddress("::ffff:93.184.216.34"), true);
    assert.equal(isPublicNetworkAddress("64:ff9b::5db8:d822"), true);
  });

  it("rejects hostnames, malformed values, and scoped IPv6 addresses", () => {
    for (const value of [
      "localhost",
      "127.0.0.1 ",
      "127.000.000.001",
      "fe80::1%eth0",
      "not-an-address",
      "",
    ]) {
      assert.throws(
        () => classifyNetworkAddress(value),
        (error: unknown) =>
          error instanceof ToolSecurityPolicyError &&
          error.code === "TOOL_NETWORK_ADDRESS_INVALID",
        value,
      );
    }
  });

  it("fails the full resolution set if any answer is unsafe", () => {
    assert.deepEqual(
      assertPublicNetworkAddresses(["1.1.1.1", "2606:4700:4700::1111"])
        .map((item) => item.address),
      ["1.1.1.1", "2606:4700:4700::1111"],
    );
    assert.throws(
      () => assertPublicNetworkAddresses(["1.1.1.1", "127.0.0.1"]),
      /loopback/,
    );
    assert.throws(() => assertPublicNetworkAddresses([]), /At least one/);
  });
});
