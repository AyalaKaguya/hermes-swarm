import { Body, Controller, Post, Req, Res } from "@nestjs/common";
import type {
  RequestPasswordResetPayload,
  ResetPasswordPayload,
} from "../../common/admin-api.types.js";
import { PublicAccess } from "@hermes-swarm/rbac";
import { PasswordResetService } from "./password-reset.service.js";
import {
  AuthRateLimitService,
  rateLimitHash,
  requestIp,
} from "../../common/security/auth-rate-limit.service.js";

@Controller("admin/auth")
/**
 * Exposes public password-reset endpoints under `/api/admin/auth`.
 * These routes complement the existing `/api/admin/auth/login` and
 * `/api/admin/auth/me` endpoints.
 */
export class PasswordResetController {
  constructor(
    private readonly passwordResetService: PasswordResetService,
    private readonly rateLimiter: AuthRateLimitService,
  ) {}

  /**
   * Requests a password-reset token for the given email.
   */
  @Post("request-password")
  @PublicAccess({ reason: "Password reset requests start without a session." })
  async requestPassword(
    @Body() payload: RequestPasswordResetPayload & { tenantSlug?: string },
    @Req() request?: any,
    @Res({ passthrough: true }) response?: any,
  ) {
    await this.rateLimiter.assertAllowed([
      {
        key: `password-reset:ip:${rateLimitHash(requestIp(request))}`,
        limit: 10,
        windowSeconds: 900,
      },
      {
        key: `password-reset:account:${rateLimitHash(
          `${payload?.tenantSlug ?? ""}:${payload?.email ?? ""}`,
        )}`,
        limit: 3,
        windowSeconds: 900,
      },
    ], response);
    return this.passwordResetService.requestReset(payload, request);
  }

  /**
   * Exchanges a reset token and email for a new password.
   */
  @Post("reset-password")
  @PublicAccess({ reason: "Password reset tokens authorize this request." })
  async resetPassword(
    @Body() payload: ResetPasswordPayload & { tenantSlug?: string },
  ) {
    return this.passwordResetService.resetPassword(payload);
  }
}
