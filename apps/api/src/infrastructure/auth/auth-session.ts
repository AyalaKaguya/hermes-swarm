import { createHmac, timingSafeEqual } from "node:crypto";
import type { AuthSessionTokenPayload } from "../../common/admin-api.types.js";

const TOKEN_VERSION = "v1";
const DEFAULT_SESSION_TTL_SECONDS = 60 * 60 * 12;
export const INTEGRATION_SESSION_PREFIX = "integration:";

export function createAuthSessionToken(
  payload: Omit<AuthSessionTokenPayload, "exp">,
  options: { secret?: string; ttlSeconds?: number } = {},
) {
  const expiresAt =
    Math.floor(Date.now() / 1000) +
    (options.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS);
  const encodedPayload = encodeBase64Url(
    JSON.stringify({ ...payload, exp: expiresAt } satisfies AuthSessionTokenPayload),
  );
  const signature = sign(encodedPayload, options.secret);
  return `${TOKEN_VERSION}.${encodedPayload}.${signature}`;
}

export function parseAuthSessionToken(
  token: string | undefined,
  options: { secret?: string } = {},
): AuthSessionTokenPayload | null {
  if (!token) {
    return null;
  }

  const [version, encodedPayload, signature] = token.split(".");
  if (version !== TOKEN_VERSION || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = sign(encodedPayload, options.secret);
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
      !payload.exp ||
      payload.exp < Math.floor(Date.now() / 1000) ||
      !hasValidTenantContext(payload.principalType, payload.tenantId)
    ) {
      return null;
    }
    return {
      exp: payload.exp,
      jti: payload.jti,
      principalType: payload.principalType,
      sessionId: payload.sessionId,
      tenantId: payload.tenantId ?? null,
      userId: payload.userId,
    };
  } catch {
    return null;
  }
}

function hasValidTenantContext(
  principalType: AuthSessionTokenPayload["principalType"],
  tenantId: unknown,
) {
  return principalType === "platform"
    ? tenantId === null
    : typeof tenantId === "string" && tenantId.length > 0;
}

function isPrincipalType(
  value: unknown,
): value is AuthSessionTokenPayload["principalType"] {
  return value === "integration" || value === "platform" || value === "tenant";
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
