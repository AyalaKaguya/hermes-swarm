import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const ENCRYPTED_SETTING_V1_PREFIX = "enc:v1";
const ENCRYPTED_SETTING_V2_PREFIX = "enc:v2";
const ENCRYPTED_SETTING_AAD = Buffer.from("hermes-swarm:setting-secret:v1");

export type SettingSecretKeyring = {
  currentKey: string;
  currentKeyId: string;
  previousKeys?: Record<string, string>;
};

export function encryptSettingSecret(
  value: string,
  secretOrKeyring: string | SettingSecretKeyring,
) {
  const keyring = normalizeKeyring(secretOrKeyring);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", createKey(keyring.currentKey), iv);
  cipher.setAAD(ENCRYPTED_SETTING_AAD);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return [
    ENCRYPTED_SETTING_V2_PREFIX,
    keyring.currentKeyId,
    iv.toString("base64url"),
    ciphertext.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
  ].join(":");
}

export function decryptSettingSecret(
  value: string,
  secretOrKeyring: string | SettingSecretKeyring,
) {
  const keyring = normalizeKeyring(secretOrKeyring);
  if (
    !value.startsWith(`${ENCRYPTED_SETTING_V1_PREFIX}:`) &&
    !value.startsWith(`${ENCRYPTED_SETTING_V2_PREFIX}:`)
  ) {
    return value;
  }

  const parts = value.split(":");
  const [prefix, version] = parts;
  const isV2 = `${prefix}:${version}` === ENCRYPTED_SETTING_V2_PREFIX;
  const keyId = isV2 ? parts[2] : keyring.currentKeyId;
  const encodedIv = parts[isV2 ? 3 : 2];
  const encodedCiphertext = parts[4];
  const encodedTag = parts[isV2 ? 5 : 3];
  if (
    (!isV2 && `${prefix}:${version}` !== ENCRYPTED_SETTING_V1_PREFIX) ||
    !keyId ||
    !encodedIv ||
    !encodedTag ||
    encodedCiphertext === undefined ||
    parts.length !== (isV2 ? 6 : 5)
  ) {
    throw new Error("Encrypted setting secret has an invalid envelope");
  }
  const secret =
    keyId === keyring.currentKeyId
      ? keyring.currentKey
      : keyring.previousKeys?.[keyId];
  if (!secret) throw new Error(`Encrypted setting secret uses unknown key: ${keyId}`);

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
  return (
    value.startsWith(`${ENCRYPTED_SETTING_V1_PREFIX}:`) ||
    value.startsWith(`${ENCRYPTED_SETTING_V2_PREFIX}:`)
  );
}

function createKey(secret: string) {
  return createHash("sha256").update(secret).digest();
}

function normalizeKeyring(
  value: string | SettingSecretKeyring,
): SettingSecretKeyring {
  return typeof value === "string"
    ? { currentKey: value, currentKeyId: "current", previousKeys: {} }
    : value;
}
