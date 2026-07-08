import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { LoginPayload } from "../../common/admin-api.types.js";
import { AuthService } from "./auth.service.js";

@Controller("admin/auth")
/**
 * Provides auth-focused admin endpoints under `/api/admin/auth`.
 */
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  /**
   * Starts an admin session with email and password credentials.
   */
  @Post("login")
  login(
    @Body() payload: LoginPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    return this.authService.login(payload, request, response);
  }

  @Post("refresh")
  refresh(@Req() request: any, @Res({ passthrough: true }) response: any) {
    return this.authService.refresh(request, response);
  }

  @Post("logout")
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Headers("authorization") authorization: string | undefined,
    @Res({ passthrough: true }) response: any,
  ) {
    await this.authService.logout(authorization, response);
  }

  @Get("sessions")
  sessions(@Headers("authorization") authorization?: string) {
    return this.authService.listSessions(authorization);
  }

  @Delete("sessions/:sessionId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Headers("authorization") authorization: string | undefined,
    @Param("sessionId") sessionId: string,
  ) {
    await this.authService.revokeSession(authorization, sessionId);
  }

  @Delete("sessions/:sessionId/record")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSessionRecord(
    @Headers("authorization") authorization: string | undefined,
    @Param("sessionId") sessionId: string,
  ) {
    await this.authService.deleteSessionRecord(authorization, sessionId);
  }

  @Delete("sessions")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOtherSessions(@Headers("authorization") authorization?: string) {
    await this.authService.revokeOtherSessions(authorization);
  }

  @Post("realtime-ticket")
  realtimeTicket(@Headers("authorization") authorization?: string) {
    return this.authService.createRealtimeTicket(authorization);
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
