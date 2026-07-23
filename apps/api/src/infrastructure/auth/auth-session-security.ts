import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import type {
  AuthSessionRecord,
  RefreshRotationResult,
} from "./auth-session.types.js";

export function createRefreshToken() {
  return randomBytes(48).toString("base64url");
}

export function hashAuthToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function isSessionExpired(record: Pick<AuthSessionRecord, "expiresAt">) {
  const expiresAt = new Date(record.expiresAt).getTime();
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

export function encryptRefreshRotation(
  value: RefreshRotationResult,
  secret: string,
) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), "utf8"),
    cipher.final(),
  ]);
  return JSON.stringify({
    ciphertext: ciphertext.toString("base64url"),
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
  });
}

export function decryptRefreshRotation(
  value: string,
  secret: string,
): RefreshRotationResult | null {
  try {
    const payload = JSON.parse(value) as Partial<{
      ciphertext: string;
      iv: string;
      tag: string;
    }>;
    if (!payload.ciphertext || !payload.iv || !payload.tag) return null;
    const decipher = createDecipheriv(
      "aes-256-gcm",
      createEncryptionKey(secret),
      Buffer.from(payload.iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(payload.tag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(payload.ciphertext, "base64url")),
      decipher.final(),
    ]);
    const issued = JSON.parse(
      plaintext.toString("utf8"),
    ) as Partial<RefreshRotationResult>;
    if (
      typeof issued.accessToken !== "string" ||
      typeof issued.expiresAt !== "string" ||
      (issued.principalType !== "platform" && issued.principalType !== "workspace") ||
      typeof issued.refreshToken !== "string" ||
      typeof issued.sessionId !== "string" ||
      (issued.principalType === "platform"
        ? issued.workspaceId !== null
        : typeof issued.workspaceId !== "string") ||
      typeof issued.userId !== "string"
    ) {
      return null;
    }
    return issued as RefreshRotationResult;
  } catch {
    return null;
  }
}

function createEncryptionKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}
