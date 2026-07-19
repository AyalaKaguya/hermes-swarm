import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ENCRYPTED_SETTING_PREFIX = "enc:v1";
const ENCRYPTED_SETTING_AAD = Buffer.from("hermes-swarm:setting-secret:v1");

export function encryptSettingSecret(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createKey(secret), iv);
  cipher.setAAD(ENCRYPTED_SETTING_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    ENCRYPTED_SETTING_PREFIX,
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decryptSettingSecret(value: string, secret: string) {
  if (!value.startsWith(`${ENCRYPTED_SETTING_PREFIX}:`)) {
    return value;
  }

  const [prefix, version, encodedIv, encodedTag, encodedCiphertext, extra] =
    value.split(":");
  if (
    `${prefix}:${version}` !== ENCRYPTED_SETTING_PREFIX ||
    !encodedIv ||
    !encodedTag ||
    encodedCiphertext === undefined ||
    extra !== undefined
  ) {
    throw new Error("Encrypted setting secret has an invalid envelope");
  }

  const decipher = createDecipheriv(
    "aes-256-gcm",
    createKey(secret),
    Buffer.from(encodedIv, "base64url"),
  );
  decipher.setAAD(ENCRYPTED_SETTING_AAD);
  decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encodedCiphertext, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function isEncryptedSettingSecret(value: string) {
  return value.startsWith(`${ENCRYPTED_SETTING_PREFIX}:`);
}

function createKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}
