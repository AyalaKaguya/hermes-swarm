import { Body, Controller, Post } from "@nestjs/common";
import type {
  RequestPasswordResetPayload,
  ResetPasswordPayload,
} from "../../common/admin-api.types.js";
import { PasswordResetService } from "./password-reset.service.js";

@Controller("admin/auth")
/**
 * Exposes public password-reset endpoints under `/api/admin/auth`.
 * These routes complement the existing `/api/admin/auth/login` and
 * `/api/admin/auth/me` endpoints.
 */
export class PasswordResetController {
  constructor(private readonly passwordResetService: PasswordResetService) {}

  /**
   * Requests a password-reset token for the given email.
   */
  @Post("request-password")
  async requestPassword(@Body() payload: RequestPasswordResetPayload) {
    return this.passwordResetService.requestReset(payload);
  }

  /**
   * Exchanges a reset token and email for a new password.
   */
  @Post("reset-password")
  async resetPassword(@Body() payload: ResetPasswordPayload) {
    return this.passwordResetService.resetPassword(payload);
  }
}
