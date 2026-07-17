import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { DataSource, MoreThan } from "typeorm";
import type { Repository } from "typeorm";
import { InjectRepository } from "@nestjs/typeorm";
import { PasswordReset, Tenant, User } from "@hermes-swarm/core";
import { PLATFORM_SETTING_KEYS } from "@hermes-swarm/core/settings/definitions";
import type {
  RequestPasswordResetPayload,
  ResetPasswordPayload,
} from "../../common/admin-api.types.js";
import { hashPassword } from "../../common/security/password-hash.js";
import { EmailSendService } from "../mail/email-send.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import {
  createPasswordResetToken,
  verifyPasswordResetToken,
} from "./password-reset-token.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { TenantLoginResolverService } from "../auth/tenant-login-resolver.service.js";
const TEN_MINUTES_MS = 10 * 60 * 1000;

@Injectable()
/**
 * Implements the migrated password-reset workflow: request a reset link by
 * email and complete the reset with a time-limited token and new password.
 */
export class PasswordResetService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
    private readonly emailSendService: EmailSendService,
    private readonly settingsService: SettingsService,
    @InjectRepository(Tenant, PLATFORM_DATA_SOURCE)
    private readonly platformTenantRepository: Repository<Tenant>,
    private readonly tenantLoginResolver: TenantLoginResolverService,
  ) {}

  /**
   * Creates a password-reset token for the account matching the provided
   * email and persists a PasswordReset record.
   */
  async requestReset(
    payload: RequestPasswordResetPayload & { tenantSlug?: string },
    request: unknown = {},
  ) {
    const input = requirePayload(payload);
    const email = normalizeEmail(input.email);
    const tenant = (await this.tenantLoginResolver.resolve(
      request,
      input.tenantSlug,
    ))?.tenant;

    if (!tenant) {
      // Return success even when the user is not found to avoid email
      // enumeration attacks.
      return { success: true };
    }

    return this.runInTenant(tenant.id, async () => {
      const user = await this.tenantContext.repository(User).findOne({
        where: { email, tenantId: tenant.id },
      });
      if (!user) return { success: true };

      const token = createPasswordResetToken({
        email: user.email,
        tenantId: tenant.id,
        userId: user.id,
      });
      const resets = this.tenantContext.repository(PasswordReset);
      await resets.save(
        resets.create({ email: user.email, tenantId: tenant.id, token }),
      );
      await this.emailSendService.send({
        email: user.email,
        languageCode: user.preferredLanguage,
        templateName: "password-reset",
        locals: {
          email: user.email,
          expiresIn: "10 分钟",
          resetLink: await this.buildPasswordResetLink(
            user.email,
            token,
            tenant.slug,
          ),
        },
      });
      return { success: true };
    });
  }

  private async buildPasswordResetLink(
    email: string,
    token: string,
    tenantSlug: string,
  ) {
    const baseUrl = await this.settingsService.getPlatformValue(
      PLATFORM_SETTING_KEYS.publicBaseUrl,
      resolvePublicBaseUrl(),
    );
    const url = new URL("/reset-password", baseUrl || resolvePublicBaseUrl());
    url.searchParams.set("email", email);
    url.searchParams.set("token", token);
    url.searchParams.set("tenantSlug", tenantSlug);
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
    let decoded: { email: string; tenantId: string; userId: string };
    try {
      decoded = verifyPasswordResetToken(token);
    } catch {
      throw new BadRequestException("令牌无效或已过期");
    }

    if (decoded.email !== email) {
      throw new BadRequestException("邮箱与令牌不匹配");
    }

    const tenant = await this.platformTenantRepository.findOne({
      where: { id: decoded.tenantId },
    });
    if (!tenant || (tenant.status !== "active" && tenant.status !== "provisioning")) {
      throw new BadRequestException("令牌无效或已过期");
    }
    if (input.tenantSlug && input.tenantSlug.trim().toLowerCase() !== tenant.slug) {
      throw new BadRequestException("租户与令牌不匹配");
    }

    await this.runInTenant(decoded.tenantId, async () => {
      const manager = this.tenantContext.current()!.manager;
      const record = await manager.findOne(PasswordReset, {
        lock: { mode: "pessimistic_write" },
        order: { createdAt: "DESC" },
        where: {
          createdAt: MoreThan(new Date(Date.now() - TEN_MINUTES_MS)),
          email,
          tenantId: decoded.tenantId,
          token,
        },
      });

      if (!record || record.expired) {
        throw new BadRequestException("令牌无效或已过期");
      }

      const user = await manager.findOne(User, {
        lock: { mode: "pessimistic_write" },
        where: { id: decoded.userId, tenantId: decoded.tenantId },
      });

      if (!user) {
        throw new NotFoundException("用户不存在");
      }

      const lockedTenant = await manager.findOne(Tenant, {
        lock: { mode: "pessimistic_write" },
        where: { id: decoded.tenantId },
      });
      if (
        !lockedTenant ||
        (lockedTenant.status !== "active" && lockedTenant.status !== "provisioning")
      ) {
        throw new BadRequestException("令牌无效或已过期");
      }

      user.passwordHash = hashPassword(password);
      user.emailVerified = true;
      await manager.save(User, user);
      const deleteResult = await manager.delete(PasswordReset, {
        id: record.id,
        tenantId: decoded.tenantId,
      });
      if (!deleteResult.affected) {
        throw new BadRequestException("令牌无效或已过期");
      }
    });

    return { success: true };
  }

  private runInTenant<T>(tenantId: string, work: () => Promise<T>) {
    return this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.scope_level', 'tenant', true)",
        [tenantId],
      );
      return this.tenantContext.run(
        {
          manager,
          organizationId: null,
          scopeLevel: "tenant",
          tenantId,
        },
        work,
      );
    });
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
