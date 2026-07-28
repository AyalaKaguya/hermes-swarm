import { isIP } from "node:net";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { ModelCapability } from "@hermes-swarm/api-contracts/ai";
import {
  ModelProviderConfigurationError,
  type ModelProviderDriver,
  type ModelProviderEndpointPolicy,
} from "./model-provider-driver.js";

export const OPENAI_COMPATIBLE_DRIVER = "openai-compatible";

const OPENAI_COMPATIBLE_CAPABILITIES = Object.freeze([
  "chat",
  "embedding",
  "rerank",
  "speechToText",
  "textToSpeech",
] satisfies ModelCapability[]);

const PRIVATE_HOST_SUFFIXES = [
  ".cluster.local",
  ".home",
  ".home.arpa",
  ".internal",
  ".lan",
  ".local",
  ".localhost",
  ".svc",
] as const;

const PRIVATE_HOST_NAMES = new Set([
  "instance-data",
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
]);

export type OpenAiCompatibleProviderConfiguration = Readonly<{
  baseUrl: string;
}>;

@Injectable()
export class OpenAiCompatibleProviderDriver
  implements ModelProviderDriver<OpenAiCompatibleProviderConfiguration>
{
  readonly descriptor = Object.freeze({
    capabilities: OPENAI_COMPATIBLE_CAPABILITIES,
    displayName: "OpenAI-compatible",
    driver: OPENAI_COMPATIBLE_DRIVER,
  });

  private readonly policy: ModelProviderEndpointPolicy;

  constructor(config: ConfigService) {
    this.policy = Object.freeze({
      allowedHosts: Object.freeze([
        ...(config.get<readonly string[]>("ai.allowedProviderHosts", []) ?? []),
      ]),
      requireHttps: config.get<boolean>("ai.requireHttps", false),
    });
  }

  normalizeConfiguration(input: unknown) {
    return normalizeOpenAiCompatibleConfiguration(input, this.policy);
  }
}

export function normalizeOpenAiCompatibleConfiguration(
  input: unknown,
  policy: ModelProviderEndpointPolicy,
): OpenAiCompatibleProviderConfiguration {
  if (!isPlainObject(input)) {
    throw invalidConfiguration("Provider configuration must be an object");
  }
  const keys = Object.keys(input);
  if (keys.length !== 1 || keys[0] !== "baseUrl") {
    throw invalidConfiguration(
      "Provider configuration accepts only the baseUrl field",
    );
  }
  if (typeof input.baseUrl !== "string" || !input.baseUrl.trim()) {
    throw invalidConfiguration("Provider base URL is required");
  }

  const allowedHosts = normalizeAllowedHosts(policy.allowedHosts);
  if (allowedHosts.size === 0) {
    throw invalidConfiguration("Provider host allowlist is empty");
  }

  const rawBaseUrl = input.baseUrl.trim();
  let url: URL;
  try {
    url = new URL(rawBaseUrl);
  } catch {
    throw invalidConfiguration("Provider base URL must be a valid URL");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw invalidConfiguration("Provider base URL must use HTTP or HTTPS");
  }
  if (policy.requireHttps && url.protocol !== "https:") {
    throw invalidConfiguration("Provider base URL must use HTTPS");
  }
  if (url.username || url.password) {
    throw invalidConfiguration("Provider base URL cannot contain credentials");
  }
  if (url.search || rawBaseUrl.includes("?")) {
    throw invalidConfiguration("Provider base URL cannot contain a query");
  }
  if (url.hash || rawBaseUrl.includes("#")) {
    throw invalidConfiguration("Provider base URL cannot contain a fragment");
  }

  validatePublicHostname(url.hostname);
  const host = url.host.toLowerCase();
  if (!allowedHosts.has(host)) {
    throw invalidConfiguration("Provider host is not allowlisted");
  }

  url.pathname = url.pathname.replace(/\/+$/, "") || "/";
  const normalized = url.toString();
  return Object.freeze({
    baseUrl: url.pathname === "/" ? normalized.replace(/\/$/, "") : normalized,
  });
}

function normalizeAllowedHosts(values: readonly string[]) {
  if (!Array.isArray(values)) {
    throw invalidConfiguration("Provider host allowlist must be an array");
  }
  const result = new Set<string>();
  for (const value of values) {
    if (typeof value !== "string" || !value.trim()) {
      throw invalidConfiguration("Provider host allowlist contains an invalid host");
    }
    const raw = value.trim().toLowerCase();
    if (raw.includes("*") || raw.includes("/") || raw.includes("?") || raw.includes("#") || raw.includes("@")) {
      throw invalidConfiguration("Provider host allowlist requires exact hosts");
    }
    let url: URL;
    try {
      url = new URL(`https://${raw}`);
    } catch {
      throw invalidConfiguration("Provider host allowlist contains an invalid host");
    }
    validatePublicHostname(url.hostname);
    result.add(url.host.toLowerCase());
  }
  return result;
}

function validatePublicHostname(value: string) {
  const hostname = value.toLowerCase();
  const unwrapped = hostname.startsWith("[") && hostname.endsWith("]")
    ? hostname.slice(1, -1)
    : hostname;
  if (isIP(unwrapped) !== 0) {
    throw invalidConfiguration("Provider hosts cannot be IP literals");
  }
  if (
    hostname.endsWith(".") ||
    !hostname.includes(".") ||
    PRIVATE_HOST_NAMES.has(hostname) ||
    PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))
  ) {
    throw invalidConfiguration("Provider host is not a public DNS name");
  }
}

function invalidConfiguration(message: string) {
  return new ModelProviderConfigurationError(message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
