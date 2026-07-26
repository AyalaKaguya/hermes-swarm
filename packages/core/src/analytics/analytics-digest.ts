import { createHash } from "node:crypto";

export function analyticsDigest(value: unknown): string {
  return createHash("sha256").update(canonicalAnalyticsJson(value)).digest("hex");
}

export function canonicalAnalyticsJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}
