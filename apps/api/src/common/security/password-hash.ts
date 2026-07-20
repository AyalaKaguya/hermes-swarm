import { pbkdf2, randomBytes, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const PASSWORD_HASH_PREFIX = "pbkdf2_sha256";
const PASSWORD_ITERATIONS = 310_000;
const PASSWORD_KEY_LENGTH = 32;
const deriveKey = promisify(pbkdf2);

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("base64url");
  const hash = await deriveKey(
    password,
    salt,
    PASSWORD_ITERATIONS,
    PASSWORD_KEY_LENGTH,
    "sha256",
  );
  return `${PASSWORD_HASH_PREFIX}$${PASSWORD_ITERATIONS}$${salt}$${hash.toString("base64url")}`;
}

export async function verifyPassword(
  password: string,
  storedHash: string | PromiseLike<string> | null | undefined,
) {
  if (!storedHash) return false;
  storedHash = await storedHash;
  if (typeof storedHash !== "string") return false;

  const [prefix, iterationsValue, salt, hash] = storedHash.split("$");
  if (prefix !== PASSWORD_HASH_PREFIX || !iterationsValue || !salt || !hash) {
    return false;
  }

  const iterations = Number(iterationsValue);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  const expected = Buffer.from(hash, "base64url");
  const actual = await deriveKey(
    password,
    salt,
    iterations,
    expected.length,
    "sha256",
  );

  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
