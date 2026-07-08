import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";

export type WebSession = {
  accessToken: string;
  expiresAt: string;
  refreshToken: string;
  sessionId: string;
};

export const WEB_SESSION_COOKIE_NAME = "hermes_web_session";

const WEB_SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const WEB_SESSION_VERSION = 1;

export function readWebSession(request: NextRequest): WebSession | null {
  const value = request.cookies.get(WEB_SESSION_COOKIE_NAME)?.value;
  if (!value) return null;
  return unsealWebSession(value);
}

export function setWebSessionCookie(response: NextResponse, session: WebSession) {
  response.cookies.set(WEB_SESSION_COOKIE_NAME, sealWebSession(session), {
    httpOnly: true,
    maxAge: WEB_SESSION_COOKIE_MAX_AGE_SECONDS,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function clearWebSessionCookie(response: NextResponse) {
  response.cookies.set(WEB_SESSION_COOKIE_NAME, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export function sealWebSession(session: WebSession) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const plaintext = Buffer.from(JSON.stringify(session), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const payload = {
    c: ciphertext.toString("base64url"),
    i: iv.toString("base64url"),
    t: cipher.getAuthTag().toString("base64url"),
    v: WEB_SESSION_VERSION,
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function unsealWebSession(value: string): WebSession | null {
  try {
    const payload = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<{ c: string; i: string; t: string; v: number }>;
    if (
      payload.v !== WEB_SESSION_VERSION ||
      !payload.c ||
      !payload.i ||
      !payload.t
    ) {
      return null;
    }

    const decipher = createDecipheriv(
      "aes-256-gcm",
      getEncryptionKey(),
      Buffer.from(payload.i, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(payload.t, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.c, "base64url")),
      decipher.final(),
    ]);
    const session = JSON.parse(plaintext.toString("utf8")) as Partial<WebSession>;
    if (
      !session.accessToken ||
      !session.refreshToken ||
      !session.expiresAt ||
      !session.sessionId
    ) {
      return null;
    }
    return {
      accessToken: session.accessToken,
      expiresAt: session.expiresAt,
      refreshToken: session.refreshToken,
      sessionId: session.sessionId,
    };
  } catch {
    return null;
  }
}

function getEncryptionKey() {
  const secret =
    process.env.WEB_SESSION_SECRET ??
    process.env.AUTH_SESSION_SECRET ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : "hermes-swarm-local-web-session-secret");
  if (!secret) {
    throw new Error("WEB_SESSION_SECRET is required in production.");
  }
  return createHash("sha256").update(secret).digest();
}
