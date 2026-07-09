import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import jwt from "jsonwebtoken";
import { MoreThan, Repository } from "typeorm";
import { PasswordReset, User, UserOrganization } from "@hermes-swarm/core";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import type {
  RequestPasswordResetPayload,
  ResetPasswordPayload,
} from "../../common/admin-api.types.js";
import { hashPassword } from "../../common/security/password-hash.js";
import { EmailSendService } from "../mail/email-send.service.js";
import { SettingsService } from "../settings/settings.service.js";

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
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    private readonly emailSendService: EmailSendService,
    private readonly settingsService: SettingsService,
  ) {}

  /**
   * Creates a password-reset token for the account matching the provided
   * email and persists a PasswordReset record.
   */
  async requestReset(payload: RequestPasswordResetPayload) {
    const input = requirePayload(payload);
    const email = normalizeEmail(input.email);
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

    const membership = await this.membershipRepository.findOne({
      order: { createdAt: "ASC" },
      where: { userId: user.id },
    });
    await this.emailSendService.send({
      email: user.email,
      organizationId: membership?.organizationId ?? null,
      templateName: "password-reset",
      locals: {
        email: user.email,
        expiresIn: "10 分钟",
        resetLink: await this.buildPasswordResetLink(user.email, token),
      },
    });

    return { success: true };
  }

  private async buildPasswordResetLink(email: string, token: string) {
    const baseUrl = await this.settingsService.getPlatformValue(
      PLATFORM_SETTING_KEYS.publicBaseUrl,
      resolvePublicBaseUrl(),
    );
    const url = new URL("/reset-password", baseUrl || resolvePublicBaseUrl());
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    return url.toString();
  }

  /**
   * Verifies the reset token, checks expiry, updates the user password, and
   * marks the email as verified.
   */
  async resetPassword(payload: ResetPasswordPayload) {
    const input = requirePayload(payload);
    const email = normalizeEmail(input.email);
    const token = requireText(input.token, "令牌");
    const password = requirePassword(input.password);
    const confirmPassword = input.confirmPassword;

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

    const passwordHash = hashPassword(password);

    await this.userRepository.manager.transaction(async (manager) => {
      const record = await manager.findOne(PasswordReset, {
        lock: { mode: "pessimistic_write" },
        order: { createdAt: "DESC" },
        where: {
          createdAt: MoreThan(new Date(Date.now() - TEN_MINUTES_MS)),
          email,
          token,
        },
      });

      if (!record || record.expired) {
        throw new BadRequestException("令牌无效或已过期");
      }

      const user = await manager.findOne(User, {
        lock: { mode: "pessimistic_write" },
        where: { id: decoded.userId },
      });

      if (!user) {
        throw new NotFoundException("用户不存在");
      }

      user.passwordHash = passwordHash;
      user.emailVerified = true;
      await manager.save(User, user);
      const deleteResult = await manager.delete(PasswordReset, { id: record.id });
      if (!deleteResult.affected) {
        throw new BadRequestException("令牌无效或已过期");
      }
    });

    return { success: true };
  }
}

function requirePayload<T extends RequestPasswordResetPayload | ResetPasswordPayload>(
  value: T,
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value;
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

function resolvePublicBaseUrl() {
  return (
    process.env.WEB_PUBLIC_URL ||
    process.env.APP_PUBLIC_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "http://localhost:3100"
  );
}
