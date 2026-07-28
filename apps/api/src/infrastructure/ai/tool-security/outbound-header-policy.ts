import { ToolSecurityPolicyError } from "./tool-security.error.js";
import { isToolGatewayControlledHeaderName } from "@hermes-swarm/api-contracts/ai";

const HEADER_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
const HEADER_VALUE_CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_NAME_BYTES = 128;
const MAX_HEADER_VALUE_BYTES = 8_192;
const MAX_TOTAL_HEADER_BYTES = 32_768;

export type NormalizedOutboundHeaders = Readonly<Record<string, string>>;

/**
 * Validates user-configured connector headers. Authentication and tracing
 * headers must be injected later by trusted Worker code after this boundary.
 */
export function normalizeOutboundHeaders(
  input: unknown,
): NormalizedOutboundHeaders {
  if (input === undefined || input === null) return Object.freeze({});
  if (!isPlainObject(input)) {
    throw headerError(
      "TOOL_HEADER_INVALID",
      "Outbound headers must be a plain object",
    );
  }
  const entries = Object.entries(input);
  if (entries.length > MAX_HEADER_COUNT) {
    throw headerError(
      "TOOL_HEADER_INVALID",
      `Outbound headers cannot exceed ${MAX_HEADER_COUNT} entries`,
    );
  }

  const normalized = new Map<string, string>();
  let totalBytes = 0;
  for (const [rawName, rawValue] of entries) {
    const name = normalizeHeaderName(rawName);
    if (normalized.has(name)) {
      throw headerError(
        "TOOL_HEADER_INVALID",
        `Outbound header is duplicated after normalization: ${name}`,
      );
    }
    if (typeof rawValue !== "string") {
      throw headerError(
        "TOOL_HEADER_INVALID",
        `Outbound header must have a single string value: ${name}`,
      );
    }
    if (HEADER_VALUE_CONTROL_PATTERN.test(rawValue)) {
      throw headerError(
        "TOOL_HEADER_INVALID",
        `Outbound header contains control characters: ${name}`,
      );
    }
    const value = rawValue.trim();
    const valueBytes = Buffer.byteLength(value, "utf8");
    if (valueBytes > MAX_HEADER_VALUE_BYTES) {
      throw headerError(
        "TOOL_HEADER_INVALID",
        `Outbound header value is too long: ${name}`,
      );
    }
    totalBytes += Buffer.byteLength(name, "ascii") + valueBytes;
    if (totalBytes > MAX_TOTAL_HEADER_BYTES) {
      throw headerError(
        "TOOL_HEADER_INVALID",
        "Outbound headers exceed the total size limit",
      );
    }
    normalized.set(name, value);
  }

  return Object.freeze(
    Object.fromEntries(
      [...normalized.entries()].sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  );
}

export function isUnsafeOutboundHeaderName(input: unknown) {
  if (typeof input !== "string") return true;
  const name = input.trim().toLowerCase();
  return (
    !HEADER_NAME_PATTERN.test(name) ||
    isToolGatewayControlledHeaderName(name)
  );
}

function normalizeHeaderName(input: string) {
  const name = input.trim().toLowerCase();
  if (
    !name ||
    Buffer.byteLength(name, "ascii") > MAX_HEADER_NAME_BYTES ||
    !HEADER_NAME_PATTERN.test(name)
  ) {
    throw headerError("TOOL_HEADER_INVALID", "Outbound header name is invalid");
  }
  if (isUnsafeOutboundHeaderName(name)) {
    throw headerError(
      "TOOL_HEADER_FORBIDDEN",
      `Outbound header is controlled by the gateway: ${name}`,
    );
  }
  return name;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function headerError(
  code: ConstructorParameters<typeof ToolSecurityPolicyError>[0],
  message: string,
) {
  return new ToolSecurityPolicyError(code, message);
}
