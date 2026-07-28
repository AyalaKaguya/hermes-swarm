import { isIP } from "node:net";
import { ToolSecurityPolicyError } from "./tool-security.error.js";

export type NetworkAddressKind =
  | "benchmark"
  | "documentation"
  | "link-local"
  | "loopback"
  | "multicast"
  | "private"
  | "public"
  | "reserved"
  | "shared"
  | "unspecified";

export type NetworkAddressClassification = Readonly<{
  address: string;
  family: 4 | 6;
  kind: NetworkAddressKind;
  public: boolean;
}>;

/**
 * Classifies a numeric address without resolving a hostname. A Worker should
 * apply this to every answer returned by its trusted resolver and repeat the
 * check after redirects and DNS refreshes to prevent rebinding.
 */
export function classifyNetworkAddress(
  input: unknown,
): NetworkAddressClassification {
  if (typeof input !== "string" || !input || input.trim() !== input) {
    throw networkError(
      "TOOL_NETWORK_ADDRESS_INVALID",
      "Resolved network address is invalid",
    );
  }
  if (input.includes("%")) {
    throw networkError(
      "TOOL_NETWORK_ADDRESS_INVALID",
      "Scoped IPv6 addresses are not allowed",
    );
  }
  const family = isIP(input);
  if (family === 4) {
    const bytes = parseIpv4(input);
    const kind = classifyIpv4(bytes);
    return Object.freeze({
      address: bytes.join("."),
      family: 4,
      kind,
      public: kind === "public",
    });
  }
  if (family === 6) {
    const bytes = parseIpv6(input);
    const kind = classifyIpv6(bytes);
    return Object.freeze({
      address: formatIpv6(bytes),
      family: 6,
      kind,
      public: kind === "public",
    });
  }
  throw networkError(
    "TOOL_NETWORK_ADDRESS_INVALID",
    "Resolved network address must be an IPv4 or IPv6 literal",
  );
}

export function isPublicNetworkAddress(input: unknown) {
  try {
    return classifyNetworkAddress(input).public;
  } catch (error) {
    if (error instanceof ToolSecurityPolicyError) return false;
    throw error;
  }
}

export function assertPublicNetworkAddress(input: unknown) {
  const classification = classifyNetworkAddress(input);
  if (!classification.public) {
    throw networkError(
      "TOOL_NETWORK_ADDRESS_FORBIDDEN",
      `Resolved ${classification.kind} network addresses are not allowed`,
    );
  }
  return classification;
}

export function assertPublicNetworkAddresses(inputs: readonly unknown[]) {
  if (!Array.isArray(inputs) || inputs.length === 0) {
    throw networkError(
      "TOOL_NETWORK_ADDRESS_INVALID",
      "At least one resolved network address is required",
    );
  }
  return Object.freeze(inputs.map((input) => assertPublicNetworkAddress(input)));
}

function classifyIpv4(bytes: readonly number[]): NetworkAddressKind {
  const [first, second] = bytes;
  if (first === 0) return "unspecified";
  if (first === 10) return "private";
  if (first === 100 && second! >= 64 && second! <= 127) return "shared";
  if (first === 127) return "loopback";
  if (first === 169 && second === 254) return "link-local";
  if (first === 172 && second! >= 16 && second! <= 31) return "private";
  if (first === 192 && second === 168) return "private";
  if (first === 192 && second === 0 && bytes[2] === 2) return "documentation";
  if (first === 198 && (second === 18 || second === 19)) return "benchmark";
  if (first === 198 && second === 51 && bytes[2] === 100) return "documentation";
  if (first === 203 && second === 0 && bytes[2] === 113) return "documentation";
  if (first! >= 224 && first! <= 239) return "multicast";
  if (
    (first === 192 && second === 0 && bytes[2] === 0) ||
    (first === 192 && second === 88 && bytes[2] === 99) ||
    first! >= 240
  ) {
    return "reserved";
  }
  return "public";
}

function classifyIpv6(bytes: Uint8Array): NetworkAddressKind {
  if (bytes.every((value) => value === 0)) return "unspecified";
  if (
    bytes.slice(0, 15).every((value) => value === 0) &&
    bytes[15] === 1
  ) {
    return "loopback";
  }

  if (isIpv4Mapped(bytes)) {
    return classifyIpv4([...bytes.slice(12)]);
  }
  if (matchesPrefix(bytes, [0x00, 0x64, 0xff, 0x9b, 0, 0, 0, 0, 0, 0, 0, 0], 96)) {
    return classifyIpv4([...bytes.slice(12)]);
  }
  if ((bytes[0]! & 0xfe) === 0xfc) return "private";
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0x80) return "link-local";
  if (bytes[0] === 0xff) return "multicast";
  if (bytes[0] === 0xfe && (bytes[1]! & 0xc0) === 0xc0) return "reserved";
  if (matchesPrefix(bytes, [0x20, 0x01, 0x0d, 0xb8], 32)) {
    return "documentation";
  }
  if (matchesPrefix(bytes, [0x3f, 0xff, 0x00], 20)) {
    return "documentation";
  }
  if (matchesPrefix(bytes, [0x20, 0x01, 0x00, 0x00], 23)) {
    return "reserved";
  }
  if (matchesPrefix(bytes, [0x20, 0x02], 16)) return "reserved";
  if (matchesPrefix(bytes, [0x01, 0x00, 0, 0, 0, 0, 0, 0], 64)) {
    return "reserved";
  }
  return (bytes[0]! & 0xe0) === 0x20 ? "public" : "reserved";
}

function parseIpv4(input: string) {
  const bytes = input.split(".").map(Number);
  if (
    bytes.length !== 4 ||
    bytes.some((value) => !Number.isInteger(value) || value < 0 || value > 255)
  ) {
    throw networkError(
      "TOOL_NETWORK_ADDRESS_INVALID",
      "Resolved IPv4 address is invalid",
    );
  }
  return bytes;
}

function parseIpv6(input: string) {
  let value = input.toLowerCase();
  if (value.includes(".")) {
    const lastColon = value.lastIndexOf(":");
    if (lastColon < 0) {
      throw networkError(
        "TOOL_NETWORK_ADDRESS_INVALID",
        "Resolved IPv6 address is invalid",
      );
    }
    const ipv4 = parseIpv4(value.slice(lastColon + 1));
    value = `${value.slice(0, lastColon)}:${(
      (ipv4[0]! << 8) |
      ipv4[1]!
    ).toString(16)}:${((ipv4[2]! << 8) | ipv4[3]!).toString(16)}`;
  }

  const compressed = value.includes("::");
  if (compressed && value.indexOf("::") !== value.lastIndexOf("::")) {
    throw networkError(
      "TOOL_NETWORK_ADDRESS_INVALID",
      "Resolved IPv6 address is invalid",
    );
  }
  const [leftText, rightText = ""] = compressed
    ? value.split("::")
    : [value, ""];
  const left = leftText ? leftText.split(":") : [];
  const right = rightText ? rightText.split(":") : [];
  if (
    [...left, ...right].some((part) => !/^[0-9a-f]{1,4}$/.test(part)) ||
    (!compressed && left.length !== 8) ||
    (compressed && left.length + right.length >= 8)
  ) {
    throw networkError(
      "TOOL_NETWORK_ADDRESS_INVALID",
      "Resolved IPv6 address is invalid",
    );
  }
  const hextets = compressed
    ? [
        ...left,
        ...Array<string>(8 - left.length - right.length).fill("0"),
        ...right,
      ]
    : left;
  const bytes = new Uint8Array(16);
  hextets.forEach((part, index) => {
    const value = Number.parseInt(part, 16);
    bytes[index * 2] = value >>> 8;
    bytes[index * 2 + 1] = value & 0xff;
  });
  return bytes;
}

function formatIpv6(bytes: Uint8Array) {
  const hextets = Array.from({ length: 8 }, (_, index) =>
    ((bytes[index * 2]! << 8) | bytes[index * 2 + 1]!).toString(16),
  );
  let bestStart = -1;
  let bestLength = 0;
  for (let index = 0; index < hextets.length; ) {
    if (hextets[index] !== "0") {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (end < hextets.length && hextets[end] === "0") end += 1;
    if (end - index > bestLength) {
      bestStart = index;
      bestLength = end - index;
    }
    index = end;
  }
  if (bestLength < 2) return hextets.join(":");
  const before = hextets.slice(0, bestStart).join(":");
  const after = hextets.slice(bestStart + bestLength).join(":");
  return `${before}::${after}`;
}

function isIpv4Mapped(bytes: Uint8Array) {
  return (
    bytes.slice(0, 10).every((value) => value === 0) &&
    bytes[10] === 0xff &&
    bytes[11] === 0xff
  );
}

function matchesPrefix(
  value: Uint8Array,
  prefix: readonly number[],
  prefixLength: number,
) {
  const fullBytes = Math.floor(prefixLength / 8);
  for (let index = 0; index < fullBytes; index += 1) {
    if (value[index] !== prefix[index]) return false;
  }
  const remainingBits = prefixLength % 8;
  if (remainingBits === 0) return true;
  const mask = (0xff << (8 - remainingBits)) & 0xff;
  return (value[fullBytes]! & mask) === ((prefix[fullBytes] ?? 0) & mask);
}

function networkError(
  code: ConstructorParameters<typeof ToolSecurityPolicyError>[0],
  message: string,
) {
  return new ToolSecurityPolicyError(code, message);
}
