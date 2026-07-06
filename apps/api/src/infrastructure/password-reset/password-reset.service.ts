import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import jwt from "jsonwebtoken";
import { MoreThan, Repository } from "typeorm";
import { PasswordReset, User } from "@hermes-swarm/core";
import type {
  RequestPasswordResetPayload,
  ResetPasswordPayload,
} from "../../common/admin-api.types.js";
import { hashPassword } from "../../common/security/password-hash.js";

const PASSWORD_RESET_JWT_SECRET =
  process.env.PASSWORD_RESET_JWT_SECRET ||
  process.env.JWT_SECRET ||
  "hermes-swarm-password-reset-secret";
const TEN_MINUTES_MS = 10 * 60 * 1000;

@Injectable()
/**
 * Implements the migrated password-reset workflow: request a reset link by
 * email and complete the reset with a time-limited token and new password.
 */
export class PasswordResetService {
  constructor(
    @InjectRepository(PasswordReset)
    private readonly passwordResetRepository: Repository<PasswordReset>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  /**
   * Creates a password-reset token for the account matching the provided
   * email and persists a PasswordReset record.
   */
  async requestReset(payload: RequestPasswordResetPayload) {
    const email = normalizeEmail(payload.email);
    const user = await this.userRepository.findOne({
      where: { email },
    });

    if (!user) {
      // Return success even when the user is not found to avoid email
      // enumeration attacks.
      return { success: true };
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email },
      PASSWORD_RESET_JWT_SECRET,
      { expiresIn: "10m" },
    );

    await this.passwordResetRepository.save(
      this.passwordResetRepository.create({
        email: user.email,
        token,
      }),
    );

    return { success: true };
  }

  /**
   * Verifies the reset token, checks expiry, updates the user password, and
   * marks the email as verified.
   */
  async resetPassword(payload: ResetPasswordPayload) {
    const email = normalizeEmail(payload.email);
    const token = requireText(payload.token, "令牌");
    const password = requirePassword(payload.password);
    const confirmPassword = payload.confirmPassword;

    if (password !== confirmPassword) {
      throw new BadRequestException("两次输入的密码不一致");
    }

    // Verify the JWT token
    let decoded: { userId: string; email: string };
    try {
      decoded = jwt.verify(token, PASSWORD_RESET_JWT_SECRET) as typeof decoded;
    } catch {
      throw new BadRequestException("令牌无效或已过期");
    }

    if (decoded.email !== email) {
      throw new BadRequestException("邮箱与令牌不匹配");
    }

    // Find an unexpired PasswordReset record
    const record = await this.passwordResetRepository.findOne({
      where: {
        email,
        token,
        createdAt: MoreThan(new Date(Date.now() - TEN_MINUTES_MS)),
      },
      order: { createdAt: "DESC" },
    });

    if (!record || record.expired) {
      throw new BadRequestException("令牌无效或已过期");
    }

    // Find the user
    const user = await this.userRepository.findOne({
      where: { id: decoded.userId },
    });

    if (!user) {
      throw new NotFoundException("用户不存在");
    }

    // Update password hash
    user.passwordHash = hashPassword(password);
    user.emailVerified = true;

    await this.userRepository.save(user);

    return { success: true };
  }
}

/**
 * Normalizes an email address to prevent casing-based mismatches.
 */
function normalizeEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

/**
 * Validates required text input with a localized field label.
 */
function requireText(value: string | undefined, label: string) {
  const text = value?.trim();
  if (!text) throw new BadRequestException(`${label}不能为空`);
  return text;
}

/**
 * Validates password input against the admin minimum policy.
 */
function requirePassword(value: string | undefined) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}
