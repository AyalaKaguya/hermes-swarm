import { isIP } from "node:net";
import { ToolSecurityPolicyError } from "./tool-security.error.js";

const PRIVATE_HOST_SUFFIXES = Object.freeze([
  ".cluster.local",
  ".home",
  ".home.arpa",
  ".internal",
  ".lan",
  ".local",
  ".localhost",
  ".svc",
]);

const PRIVATE_HOST_NAMES = new Set([
  "instance-data",
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
]);

const DNS_LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const AMBIGUOUS_PATH_ESCAPE_PATTERN = /%(?:25|2e|2f|3b|5c)/i;
const URL_WHITESPACE_PATTERN = /[\u0000-\u0020\u007f-\u009f\s]/u;

export type ApprovedEndpointScheme = "http" | "https";

export type ApprovedEndpointPolicyOptions = Readonly<{
  /** Trusted callers may set this only for an explicitly selected dev mode. */
  allowHttpInDevelopment?: boolean;
}>;

export type OutboundTargetPolicyOptions = ApprovedEndpointPolicyOptions &
  Readonly<{
    /** Query parameters remain opt-in for a concrete connector operation. */
    allowQuery?: boolean;
  }>;

export type NormalizedApprovedEndpoint = Readonly<{
  authority: string;
  hostname: string;
  pathPrefix: string;
  port: number;
  scheme: ApprovedEndpointScheme;
  url: string;
}>;

export type NormalizedOutboundTarget = Readonly<{
  authority: string;
  hostname: string;
  path: string;
  port: number;
  query: string;
  scheme: ApprovedEndpointScheme;
  url: string;
}>;

/**
 * Normalizes a persistent HTTP or Streamable HTTP MCP endpoint. This performs
 * no DNS lookup; resolved addresses must be checked separately immediately
 * before a Worker opens a connection.
 */
export function normalizeApprovedEndpoint(
  input: unknown,
  options: ApprovedEndpointPolicyOptions = {},
): NormalizedApprovedEndpoint {
  const parsed = parseEndpoint(input, {
    allowHttpInDevelopment: options.allowHttpInDevelopment === true,
    allowQuery: false,
  });
  const url = endpointUrl(parsed.scheme, parsed.authority, parsed.path);
  return Object.freeze({
    authority: parsed.authority,
    hostname: parsed.hostname,
    pathPrefix: parsed.path,
    port: parsed.port,
    scheme: parsed.scheme,
    url,
  });
}

export function normalizeApprovedEndpoints(
  inputs: readonly unknown[],
  options: ApprovedEndpointPolicyOptions = {},
): readonly NormalizedApprovedEndpoint[] {
  if (!Array.isArray(inputs)) {
    throw policyError(
      "TOOL_ENDPOINT_INVALID",
      "Approved endpoints must be an array",
    );
  }
  const byUrl = new Map<string, NormalizedApprovedEndpoint>();
  for (const input of inputs) {
    const endpoint = normalizeApprovedEndpoint(input, options);
    byUrl.set(endpoint.url, endpoint);
  }
  return Object.freeze(
    [...byUrl.values()].sort((left, right) => left.url.localeCompare(right.url)),
  );
}

/**
 * Revalidates a concrete request or redirect target against a stored endpoint.
 * Scheme, hostname and effective port must match exactly. The path may equal
 * the approved prefix or descend below a `/` segment boundary.
 */
export function assertTargetMatchesApprovedEndpoint(
  input: unknown,
  approved: NormalizedApprovedEndpoint,
  options: OutboundTargetPolicyOptions = {},
): NormalizedOutboundTarget {
  const parsed = parseEndpoint(input, {
    allowHttpInDevelopment:
      approved.scheme === "http" && options.allowHttpInDevelopment === true,
    allowQuery: options.allowQuery === true,
  });
  if (
    parsed.scheme !== approved.scheme ||
    parsed.hostname !== approved.hostname ||
    parsed.port !== approved.port ||
    !isPathWithinPrefix(parsed.path, approved.pathPrefix)
  ) {
    throw policyError(
      "TOOL_ENDPOINT_NOT_APPROVED",
      "Outbound target is outside the approved endpoint boundary",
    );
  }
  const url = `${endpointUrl(parsed.scheme, parsed.authority, parsed.path)}${parsed.query}`;
  return Object.freeze({
    authority: parsed.authority,
    hostname: parsed.hostname,
    path: parsed.path,
    port: parsed.port,
    query: parsed.query,
    scheme: parsed.scheme,
    url,
  });
}

export function isTargetWithinApprovedEndpoint(
  input: unknown,
  approved: NormalizedApprovedEndpoint,
  options: OutboundTargetPolicyOptions = {},
) {
  try {
    assertTargetMatchesApprovedEndpoint(input, approved, options);
    return true;
  } catch (error) {
    if (error instanceof ToolSecurityPolicyError) return false;
    throw error;
  }
}

export function isPathWithinPrefix(path: string, pathPrefix: string) {
  return (
    pathPrefix === "/" ||
    path === pathPrefix ||
    path.startsWith(`${pathPrefix}/`)
  );
}

type ParsedEndpoint = Readonly<{
  authority: string;
  hostname: string;
  path: string;
  port: number;
  query: string;
  scheme: ApprovedEndpointScheme;
}>;

function parseEndpoint(
  input: unknown,
  options: Required<OutboundTargetPolicyOptions>,
): ParsedEndpoint {
  if (typeof input !== "string" || !input.trim()) {
    throw policyError("TOOL_ENDPOINT_INVALID", "Endpoint URL is required");
  }
  const raw = input.trim();
  if (raw.length > 2_048 || URL_WHITESPACE_PATTERN.test(raw)) {
    throw policyError(
      "TOOL_ENDPOINT_INVALID",
      "Endpoint URL contains invalid whitespace or is too long",
    );
  }
  if (raw.includes("*")) {
    throw policyError(
      "TOOL_ENDPOINT_HOST_FORBIDDEN",
      "Endpoint wildcards are not allowed",
    );
  }
  if (raw.includes("\\")) {
    throw policyError(
      "TOOL_ENDPOINT_COMPONENT_FORBIDDEN",
      "Endpoint paths cannot contain backslashes",
    );
  }
  const rawPath = extractRawPath(raw);
  if (rawPath.includes(";") || AMBIGUOUS_PATH_ESCAPE_PATTERN.test(rawPath)) {
    throw policyError(
      "TOOL_ENDPOINT_COMPONENT_FORBIDDEN",
      "Endpoint path contains an ambiguous encoded separator",
    );
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw policyError("TOOL_ENDPOINT_INVALID", "Endpoint must be a valid URL");
  }

  const scheme = normalizeScheme(url.protocol, options.allowHttpInDevelopment);
  if (extractRawAuthority(raw).includes("@") || url.username || url.password) {
    throw policyError(
      "TOOL_ENDPOINT_COMPONENT_FORBIDDEN",
      "Endpoint credentials are not allowed",
    );
  }
  if (raw.includes("#") || url.hash) {
    throw policyError(
      "TOOL_ENDPOINT_COMPONENT_FORBIDDEN",
      "Endpoint fragments are not allowed",
    );
  }
  const hasQueryMarker = raw.includes("?");
  if (hasQueryMarker && (!options.allowQuery || !url.search)) {
    throw policyError(
      "TOOL_ENDPOINT_COMPONENT_FORBIDDEN",
      "Endpoint query parameters are not allowed",
    );
  }

  const hostname = normalizePublicHostname(url.hostname);
  const path = normalizePath(url.pathname);
  const port = url.port ? Number(url.port) : scheme === "https" ? 443 : 80;
  const authority = url.port ? `${hostname}:${url.port}` : hostname;
  return Object.freeze({
    authority,
    hostname,
    path,
    port,
    query: url.search,
    scheme,
  });
}

function normalizeScheme(
  protocol: string,
  allowHttpInDevelopment: boolean,
): ApprovedEndpointScheme {
  if (protocol === "https:") return "https";
  if (protocol === "http:" && allowHttpInDevelopment) return "http";
  if (protocol === "http:") {
    throw policyError(
      "TOOL_ENDPOINT_SCHEME_FORBIDDEN",
      "HTTP endpoints require an explicit development-only override",
    );
  }
  throw policyError(
    "TOOL_ENDPOINT_SCHEME_FORBIDDEN",
    "Endpoint must use HTTPS",
  );
}

function normalizePublicHostname(value: string) {
  const hostname = value.toLowerCase();
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(unwrapped) !== 0) {
    throw policyError(
      "TOOL_ENDPOINT_HOST_FORBIDDEN",
      "Endpoint hosts cannot be IP literals",
    );
  }
  if (
    !hostname ||
    hostname.length > 253 ||
    hostname.endsWith(".") ||
    !hostname.includes(".") ||
    PRIVATE_HOST_NAMES.has(hostname) ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw policyError(
      "TOOL_ENDPOINT_HOST_FORBIDDEN",
      "Endpoint host must be a public fully qualified DNS name",
    );
  }
  const labels = hostname.split(".");
  if (labels.some((label) => !DNS_LABEL_PATTERN.test(label))) {
    throw policyError(
      "TOOL_ENDPOINT_HOST_FORBIDDEN",
      "Endpoint host contains an invalid DNS label",
    );
  }
  return hostname;
}

function normalizePath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  if (normalized.includes("//")) {
    throw policyError(
      "TOOL_ENDPOINT_COMPONENT_FORBIDDEN",
      "Endpoint path cannot contain repeated separators",
    );
  }
  return normalized;
}

function extractRawPath(raw: string) {
  const authorityStart = raw.indexOf("://");
  if (authorityStart < 0) return "";
  const pathStart = raw.indexOf("/", authorityStart + 3);
  if (pathStart < 0) return "";
  const queryStart = raw.indexOf("?", pathStart);
  const fragmentStart = raw.indexOf("#", pathStart);
  const ends = [queryStart, fragmentStart].filter((value) => value >= 0);
  return raw.slice(pathStart, ends.length > 0 ? Math.min(...ends) : undefined);
}

function extractRawAuthority(raw: string) {
  const authorityStart = raw.indexOf("://");
  if (authorityStart < 0) return "";
  const start = authorityStart + 3;
  const ends = ["/", "?", "#"]
    .map((delimiter) => raw.indexOf(delimiter, start))
    .filter((value) => value >= 0);
  return raw.slice(start, ends.length > 0 ? Math.min(...ends) : undefined);
}

function endpointUrl(
  scheme: ApprovedEndpointScheme,
  authority: string,
  path: string,
) {
  return `${scheme}://${authority}${path === "/" ? "" : path}`;
}

function policyError(
  code: ConstructorParameters<typeof ToolSecurityPolicyError>[0],
  message: string,
) {
  return new ToolSecurityPolicyError(code, message);
}
