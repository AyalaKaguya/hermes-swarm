import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthSessionTokenPayload } from "../../common/admin-api.types.js";

const TOKEN_VERSION = "v2";
const LEGACY_TOKEN_VERSION = "v1";
const DEFAULT_KEY_ID = "current";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const INTEGRATION_SESSION_PREFIX = "integration:";

export function createAuthSessionToken(
  payload: Omit<AuthSessionTokenPayload, "credentialVersion" | "exp" | "kid"> & {
    credentialVersion?: number;
  },
  options: { keyId?: string; secret?: string; ttlSeconds?: number } = {},
) {
  const expiresAt =
    Math.floor(Date.now() / 1000) +
    (options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS);
  const encodedPayload = encodeBase64Url(
    JSON.stringify({
      ...payload,
      credentialVersion: payload.credentialVersion ?? 0,
      exp: expiresAt,
      kid: options.keyId ?? DEFAULT_KEY_ID,
    } satisfies AuthSessionTokenPayload),
  );
  const signature = sign(encodedPayload, options.secret);
  return `${TOKEN_VERSION}.${options.keyId ?? DEFAULT_KEY_ID}.${encodedPayload}.${signature}`;
}

export function parseAuthSessionToken(
  token: string | undefined,
  options: {
    keyId?: string;
    previousKeys?: Record<string, string>;
    secret?: string;
  } = {},
): AuthSessionTokenPayload | null {
  if (!token) {
    return null;
  }

  const parts = token.split(".");
  const version = parts[0];
  const keyId =
    version === TOKEN_VERSION
      ? parts[1]
      : version === LEGACY_TOKEN_VERSION
        ? options.keyId ?? DEFAULT_KEY_ID
        : undefined;
  const encodedPayload = version === TOKEN_VERSION ? parts[2] : parts[1];
  const signature = version === TOKEN_VERSION ? parts[3] : parts[2];
  if (!keyId || !encodedPayload || !signature || parts.length !== (version === TOKEN_VERSION ? 4 : 3)) {
    return null;
  }

  const secret =
    keyId === (options.keyId ?? DEFAULT_KEY_ID)
      ? options.secret
      : options.previousKeys?.[keyId];
  if (!secret && keyId !== (options.keyId ?? DEFAULT_KEY_ID)) return null;
  const expectedSignature = sign(encodedPayload, secret);
  if (!secureEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8"),
    ) as Partial<AuthSessionTokenPayload>;
    if (
      !payload.userId ||
      !isPrincipalType(payload.principalType) ||
      !payload.sessionId ||
      !payload.jti ||
      !Number.isInteger(payload.credentialVersion) ||
      payload.credentialVersion! < 0 ||
      !payload.exp ||
      payload.exp < Math.floor(Date.now() / 1000) ||
      !hasValidWorkspaceContext(payload.principalType, payload.workspaceId)
    ) {
      return null;
    }
    return {
      accountId:
        typeof payload.accountId === "string" ? payload.accountId : payload.userId,
      credentialVersion: payload.credentialVersion!,
      exp: payload.exp,
      jti: payload.jti,
      kid: payload.kid ?? keyId,
      membershipId:
        typeof payload.membershipId === "string" ? payload.membershipId : null,
      principalType: payload.principalType,
      sessionId: payload.sessionId,
      workspaceId: payload.workspaceId ?? null,
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}

function hasValidWorkspaceContext(
  principalType: AuthSessionTokenPayload["principalType"],
  workspaceId: unknown,
) {
  return principalType === "platform"
    ? workspaceId === null
    : typeof workspaceId === "string" && workspaceId.length > 0;
}

function isPrincipalType(
  value: unknown,
): value is AuthSessionTokenPayload["principalType"] {
  return value === "integration" || value === "platform" || value === "workspace";
}

function sign(encodedPayload: string, secret?: string) {
  return createHmac("sha256", secret ?? getSessionSecret())
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
