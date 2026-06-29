import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthSessionTokenPayload } from "./tenancy.types.js";

const TOKEN_VERSION = "v1";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;

export function createAuthSessionToken(
  payload: Omit<AuthSessionTokenPayload, "exp">,
) {
  const expiresAt =
    Math.floor(Date.now() / 1000) + DEFAULT_SESSION_TTL_SECONDS;
  const encodedPayload = encodeBase64Url(
    JSON.stringify({ ...payload, exp: expiresAt } satisfies AuthSessionTokenPayload),
  );
  const signature = sign(encodedPayload);
  return `${TOKEN_VERSION}.${encodedPayload}.${signature}`;
}

export function parseAuthSessionToken(
  token: string | undefined,
): AuthSessionTokenPayload | null {
  if (!token) {
    return null;
  }

  const [version, encodedPayload, signature] = token.split(".");
  if (version !== TOKEN_VERSION || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload);
  if (!secureEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<AuthSessionTokenPayload>;
    if (
      !payload.userId ||
      !payload.exp ||
      payload.exp < Math.floor(Date.now() / 1000)
    ) {
      return null;
    }
    return {
      exp: payload.exp,
      organizationId: payload.organizationId ?? null,
      scopeLevel: payload.scopeLevel === "platform" ? "platform" : "organization",
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}

function sign(encodedPayload: string) {
  return createHmac("sha256", getSessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function secureEqual(value: string, expected: string) {
  const valueBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    valueBuffer.length === expectedBuffer.length &&
    timingSafeEqual(valueBuffer, expectedBuffer)
  );
}

function encodeBase64Url(value: string) {
  return Buffer.from(value).toString("base64url");
}

function getSessionSecret() {
  return (
    process.env.AUTH_SESSION_SECRET ||
    process.env.JWT_SECRET ||
    "hermes-swarm-local-auth-secret"
  );
}
