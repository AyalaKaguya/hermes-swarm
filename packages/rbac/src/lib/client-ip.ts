import { isIP } from "node:net";

export type ClientIpRequest = {
  headers?: Record<string, string | string[] | undefined>;
  ip?: unknown;
  socket?: { remoteAddress?: unknown };
};

export type ClientIpOptions = {
  trustedProxyCidrs?: readonly string[];
};

const SINGLE_VALUE_CLIENT_IP_HEADERS = [
  "cf-connecting-ip",
  "true-client-ip",
  "fastly-client-ip",
  "x-azure-clientip",
  "x-envoy-external-address",
  "x-real-ip",
] as const;

/**
 * Resolves a normalized client IP without trusting browser-controlled forwarding
 * headers. Forwarding headers are considered only when the direct TCP peer is in
 * TRUSTED_PROXY_CIDRS (or the explicitly supplied trustedProxyCidrs).
 */
export function resolveClientIp(
  request: ClientIpRequest | null | undefined,
  options: ClientIpOptions = {},
) {
  const peerIp = normalizeIp(
    request?.socket?.remoteAddress ?? request?.ip,
  );
  if (!peerIp) return null;

  const trustedProxyCidrs =
    options.trustedProxyCidrs ?? readTrustedProxyCidrs(process.env);
  const trustedNetworks = parseTrustedProxyCidrs(trustedProxyCidrs);
  if (!isTrustedProxy(peerIp, trustedNetworks)) return peerIp;

  const forwarded = readHeader(request, "forwarded");
  const forwardedChain = forwarded
    ? parseForwardedHeader(forwarded)
    : [];
  const fromForwarded = resolveForwardedChain(
    forwardedChain,
    peerIp,
    trustedNetworks,
  );
  if (fromForwarded) return fromForwarded;

  const forwardedFor = readHeader(request, "x-forwarded-for");
  const fromForwardedFor = resolveForwardedChain(
    forwardedFor ? parseForwardedForHeader(forwardedFor) : [],
    peerIp,
    trustedNetworks,
  );
  if (fromForwardedFor) return fromForwardedFor;

  for (const header of SINGLE_VALUE_CLIENT_IP_HEADERS) {
    const candidate = normalizeIp(readHeader(request, header));
    if (candidate) return candidate;
  }

  return peerIp;
}

export function readTrustedProxyCidrs(
  environment: { TRUSTED_PROXY_CIDRS?: string },
) {
  return (
    environment.TRUSTED_PROXY_CIDRS?.split(",")
      .map((item) => item.trim())
      .filter(Boolean) ?? []
  );
}

export function validateTrustedProxyCidrs(value: unknown) {
  if (value === undefined || value === null || value === "") return;
  const cidrs = String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  parseTrustedProxyCidrs(cidrs);
}

type TrustedNetwork = {
  bits: number;
  network: bigint;
  prefix: number;
  version: 4 | 6;
};

function parseTrustedProxyCidrs(cidrs: readonly string[]) {
  return cidrs.map((cidr) => {
    const [rawAddress, rawPrefix, ...rest] = cidr.split("/");
    if (rest.length > 0 || !rawAddress) {
      throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
    }
    const address = normalizeIp(rawAddress);
    if (!address) throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
    const version = isIP(address) as 4 | 6;
    const bits = version === 4 ? 32 : 128;
    const prefix =
      rawPrefix === undefined || rawPrefix === ""
        ? bits
        : Number(rawPrefix);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > bits) {
      throw new Error(`Invalid trusted proxy CIDR: ${cidr}`);
    }
    const value = ipToBigInt(address, version);
    const mask = prefix === 0
      ? 0n
      : ((1n << BigInt(prefix)) - 1n) << BigInt(bits - prefix);
    return {
      bits,
      network: value & mask,
      prefix,
      version,
    };
  });
}

function isTrustedProxy(ip: string, networks: readonly TrustedNetwork[]) {
  const version = isIP(ip) as 4 | 6;
  if (!version) return false;
  const value = ipToBigInt(ip, version);
  return networks.some((network) => {
    if (network.version !== version) return false;
    const mask = network.prefix === 0
      ? 0n
      : ((1n << BigInt(network.prefix)) - 1n) <<
        BigInt(network.bits - network.prefix);
    return (value & mask) === network.network;
  });
}

function resolveForwardedChain(
  chain: readonly string[],
  peerIp: string,
  trustedNetworks: readonly TrustedNetwork[],
) {
  if (chain.length === 0) return null;
  const hops = [...chain, peerIp];
  for (let index = hops.length - 1; index >= 0; index -= 1) {
    const hop = hops[index];
    if (!hop) continue;
    if (!isTrustedProxy(hop, trustedNetworks)) return hop;
  }
  return hops[0] ?? null;
}

function parseForwardedHeader(value: string) {
  return value
    .split(",")
    .map((element) => {
      const parameter = element
        .split(";")
        .map((item) => item.trim())
        .find((item) => /^for=/i.test(item));
      return normalizeIp(parameter?.replace(/^for=/i, ""));
    })
    .filter((item): item is string => Boolean(item));
}

function parseForwardedForHeader(value: string) {
  return value
    .split(",")
    .map((item) => normalizeIp(item))
    .filter((item): item is string => Boolean(item));
}

function readHeader(
  request: ClientIpRequest | null | undefined,
  name: string,
) {
  const headers = request?.headers;
  if (!headers) return null;
  const value =
    headers[name] ??
    Object.entries(headers).find(
      ([key]) => key.toLowerCase() === name,
    )?.[1];
  return Array.isArray(value) ? value[0] ?? null : value ?? null;
}

function normalizeIp(value: unknown) {
  if (typeof value !== "string") return null;
  let candidate = value.trim();
  if (!candidate) return null;
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }
  if (
    !candidate ||
    candidate.toLowerCase() === "unknown" ||
    candidate.startsWith("_")
  ) {
    return null;
  }

  const bracketed = candidate.match(/^\[([^\]]+)](?::\d+)?$/);
  if (bracketed?.[1]) candidate = bracketed[1];

  const mappedIpv4 = candidate.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mappedIpv4?.[1] && isIP(mappedIpv4[1]) === 4) {
    return mappedIpv4[1];
  }

  if (isIP(candidate)) return candidate.toLowerCase();

  const ipv4WithPort = candidate.match(/^(\d+\.\d+\.\d+\.\d+):\d+$/);
  if (ipv4WithPort?.[1] && isIP(ipv4WithPort[1]) === 4) {
    return ipv4WithPort[1];
  }
  return null;
}

function ipToBigInt(ip: string, version: 4 | 6) {
  if (version === 4) {
    return ip
      .split(".")
      .reduce((value, part) => (value << 8n) | BigInt(Number(part)), 0n);
  }

  const [head = "", tail = ""] = ip.split("::");
  const headParts = head ? head.split(":") : [];
  const tailParts = tail ? tail.split(":") : [];
  const missing = 8 - headParts.length - tailParts.length;
  const parts = ip.includes("::")
    ? [...headParts, ...Array(Math.max(0, missing)).fill("0"), ...tailParts]
    : headParts;
  return parts.reduce(
    (value, part) => (value << 16n) | BigInt(parseInt(part || "0", 16)),
    0n,
  );
}
