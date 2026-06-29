import { randomBytes, pbkdf2Sync, timingSafeEqual } from "node:crypto";

const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_KEY_LENGTH = 32;

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = pbkdf2Sync(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    "sha256",
  ).toString("base64url");
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

export function verifyPassword(
  password: string,
  storedHash: string | null | undefined,
) {
  if (!storedHash) return false;

  const [prefix, iterationsValue, salt, hash] = storedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !iterationsValue || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = pbkdf2Sync(
    password,
    salt,
    iterations,
    expected.length,
    "sha256",
  );

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
