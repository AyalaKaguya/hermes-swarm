import { Body, Controller, Get, Headers, Post } from "@nestjs/common";
import type { LoginPayload } from "../tenancy/tenancy.types.js";
import { AuthService } from "./auth.service.js";

@Controller("admin/auth")
/**
 * Provides auth-focused admin endpoints under `/api/admin/auth` while the
 * legacy `/api/admin/login` alias remains in the admin controller.
 */
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Starts an admin session with email and password credentials.
   */
  @Post("login")
  login(@Body() payload: LoginPayload) {
    return this.authService.login(payload);
  }

  /**
   * Returns whether the supplied authorization header is still valid.
   */
  @Get("authenticated")
  authenticated(@Headers("authorization") authorization?: string) {
    return this.authService.authenticated(authorization);
  }

  /**
   * Returns the current admin principal and its authorization context.
   */
  @Get("me")
  me(@Headers("authorization") authorization?: string) {
    return this.authService.me(authorization);
  }
}
