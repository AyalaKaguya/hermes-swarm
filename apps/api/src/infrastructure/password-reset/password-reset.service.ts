import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import { Account, PasswordReset } from "@hermes-swarm/core";
import { DataSource, MoreThan, Repository } from "typeorm";
import type {
  RequestPasswordResetPayload,
  ResetPasswordPayload,
} from "../../common/admin-api.types.js";
import { hashPassword } from "../../common/security/password-hash.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { PlatformEmailSendService } from "../mail/platform-email-send.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "./password-reset-token.js";

const TEN_MINUTES_MS = 10 * 60 * 1000;

@Injectable()
export class PasswordResetService {
  constructor(
    @InjectDataSource()
    private readonly platformDataSource: DataSource,
    @InjectRepository(Account)
    private readonly accounts: Repository<Account>,
    @InjectRepository(PasswordReset)
    private readonly resets: Repository<PasswordReset>,
    private readonly platformEmailSendService: PlatformEmailSendService,
    private readonly settingsService: SettingsService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async requestReset(payload: RequestPasswordResetPayload) {
    const email = normalizeEmail(requirePayload(payload).email);
    const account = await this.accounts.findOne({ where: { email } });
    if (!account || account.status !== "active") return { success: true };

    const token = createPasswordResetToken({
      accountId: account.id,
      email: account.email,
    });
    await this.resets.save(
      this.resets.create({ email: account.email, token }),
    );
    await this.platformEmailSendService.send({
      email: account.email,
      languageCode: account.preferredLanguage ?? "zh-CN",
      templateName: "password-reset",
      locals: {
        email: account.email,
        expiresIn: "10 分钟",
        resetLink: await this.buildPasswordResetLink(account.email, token),
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

  async resetPassword(payload: ResetPasswordPayload) {
    const input = requirePayload(payload);
    const email = normalizeEmail(input.email);
    const token = requireText(input.token, "令牌");
    const password = requirePassword(input.password);
    if (password !== input.confirmPassword) {
      throw new BadRequestException("两次输入的密码不一致");
    }

    let decoded: { accountId: string; email: string };
    try {
      decoded = verifyPasswordResetToken(token);
    } catch {
      throw new BadRequestException("令牌无效或已过期");
    }
    if (decoded.email !== email) {
      throw new BadRequestException("邮箱与令牌不匹配");
    }

    await this.platformDataSource.transaction(async (manager) => {
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
      const account = await manager.findOne(Account, {
        lock: { mode: "pessimistic_write" },
        where: { id: decoded.accountId },
      });
      if (!account) throw new NotFoundException("账号不存在");

      account.passwordHash = await hashPassword(password);
      account.credentialVersion += 1;
      account.credentialsChangedAt = new Date();
      account.emailVerified = true;
      account.updatedAt = new Date();
      await manager.save(Account, account);
      const deleted = await manager.delete(PasswordReset, { id: record.id });
      if (!deleted.affected) {
        throw new BadRequestException("令牌无效或已过期");
      }
    });
    await this.authSessionService.revokeAccountSessions(decoded.accountId);
    return { reauthenticationRequired: true, success: true };
  }
}

function requirePayload<T extends object>(value: T): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value;
}

function normalizeEmail(value: unknown) {
  const email = requireText(value, "邮箱").toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new BadRequestException("邮箱格式不正确");
  }
  return email;
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function requirePassword(value: unknown) {
  const password = requireText(value, "密码");
  if (password.length < 8) throw new BadRequestException("密码至少需要 8 位");
  return password;
}

function resolvePublicBaseUrl() {
  return process.env.PUBLIC_BASE_URL ?? "http://localhost:3100";
}
