import jwt from "jsonwebtoken";

export type PasswordResetTokenPayload = {
  email: string;
  tenantId: string;
  userId: string;
};

const PASSWORD_RESET_JWT_SECRET =
  process.env.PASSWORD_RESET_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "hermes-swarm-password-reset-secret";

export function createPasswordResetToken(payload: PasswordResetTokenPayload) {
  return jwt.sign(payload, PASSWORD_RESET_JWT_SECRET, { expiresIn: "10m" });
}

export function verifyPasswordResetToken(token: string) {
  return jwt.verify(token, PASSWORD_RESET_JWT_SECRET) as PasswordResetTokenPayload;
}
