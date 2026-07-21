import jwt from "jsonwebtoken";

export type PasswordResetTokenPayload = {
  accountId: string;
  email: string;
};

export function createPasswordResetToken(payload: PasswordResetTokenPayload) {
  return jwt.sign(payload, getPasswordResetSecret(), { expiresIn: "10m" });
}

export function verifyPasswordResetToken(token: string) {
  return jwt.verify(token, getPasswordResetSecret()) as PasswordResetTokenPayload;
}

function getPasswordResetSecret() {
  const secret =
    process.env.PASSWORD_RESET_TOKEN_SECRET ??
    (process.env.NODE_ENV === "production"
      ? undefined
      : process.env.PASSWORD_RESET_JWT_SECRET ??
        process.env.JWT_SECRET ??
        "hermes-swarm-password-reset-secret");
  if (!secret) {
    throw new Error("PASSWORD_RESET_TOKEN_SECRET is required in production");
  }
  return secret;
}
