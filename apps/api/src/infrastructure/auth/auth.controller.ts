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
import { PublicAccess } from "@hermes-swarm/rbac";
import { AuthService } from "./auth.service.js";
import { TenantLoginResolverService } from "./tenant-login-resolver.service.js";

@Controller("admin/auth")
/**
 * Provides auth-focused admin endpoints under `/api/admin/auth`.
 */
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tenantLoginResolver: TenantLoginResolverService,
  ) {}

  @Post("tenant-context")
  @PublicAccess({ reason: "Tenant workspace discovery happens before login." })
  async tenantContext(
    @Body() payload: { workspace?: string } | null,
    @Req() request: any,
  ) {
    const workspace = payload?.workspace;
    const resolution = await this.tenantLoginResolver.resolve(request, workspace);
    if (workspace?.trim() && !resolution) {
      return { source: null, tenant: null };
    }
    return this.tenantLoginResolver.toPublicContext(resolution);
  }

  /**
   * Starts an admin session with email and password credentials.
   */
  @Post("login")
  @PublicAccess({ reason: "Credential validation is handled by AuthService." })
  login(
    @Body() payload: LoginPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    return this.authService.login(payload, request, response);
  }

  @Post("platform/login")
  @PublicAccess({ reason: "Platform credential validation is handled by AuthService." })
  platformLogin(
    @Body() payload: LoginPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    return this.authService.loginPlatform(payload, request, response);
  }

  @Post("refresh")
  @PublicAccess({ reason: "Refresh cookie validation is handled by AuthService." })
  refresh(@Req() request: any, @Res({ passthrough: true }) response: any) {
    return this.authService.refresh(request, response, "tenant");
  }

  @Post("logout")
  @PublicAccess({ reason: "Current session validation is handled by AuthService." })
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Headers("authorization") authorization: string | undefined,
    @Res({ passthrough: true }) response: any,
  ) {
    await this.authService.logout(authorization, response);
  }

  @Get("sessions")
  @PublicAccess({ reason: "Current session validation is handled by AuthService." })
  sessions(@Headers("authorization") authorization?: string) {
    return this.authService.listSessions(authorization);
  }

  @Delete("sessions/:sessionId")
  @PublicAccess({ reason: "Current session validation is handled by AuthService." })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeSession(
    @Headers("authorization") authorization: string | undefined,
    @Param("sessionId") sessionId: string,
  ) {
    await this.authService.revokeSession(authorization, sessionId);
  }

  @Delete("sessions/:sessionId/record")
  @PublicAccess({ reason: "Current session validation is handled by AuthService." })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteSessionRecord(
    @Headers("authorization") authorization: string | undefined,
    @Param("sessionId") sessionId: string,
  ) {
    await this.authService.deleteSessionRecord(authorization, sessionId);
  }

  @Delete("sessions")
  @PublicAccess({ reason: "Current session validation is handled by AuthService." })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeOtherSessions(@Headers("authorization") authorization?: string) {
    await this.authService.revokeOtherSessions(authorization);
  }

  @Post("realtime-ticket")
  @PublicAccess({ reason: "Current session validation is handled by AuthService." })
  realtimeTicket(@Headers("authorization") authorization?: string) {
    return this.authService.createRealtimeTicket(authorization);
  }

  /**
   * Returns whether the supplied authorization header is still valid.
   */
  @Get("authenticated")
  @PublicAccess({ reason: "Current session validation is handled by AuthService." })
  authenticated(@Headers("authorization") authorization?: string) {
    return this.authService.authenticated(authorization);
  }

  /**
   * Returns the current admin principal and its authorization context.
   */
  @Get("me")
  @PublicAccess({ reason: "Current session validation is handled by AuthService." })
  me(@Headers("authorization") authorization?: string) {
    return this.authService.me(authorization);
  }
}

@Controller("admin/platform/auth")
export class PlatformAuthController {
  constructor(private readonly authService: AuthService) {}

  @Post("login")
  @PublicAccess({ reason: "Platform credential validation is handled by AuthService." })
  login(
    @Body() payload: LoginPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    return this.authService.loginPlatform(payload, request, response);
  }

  @Post("refresh")
  @PublicAccess({ reason: "Refresh cookie validation is handled by AuthService." })
  refresh(@Req() request: any, @Res({ passthrough: true }) response: any) {
    return this.authService.refresh(request, response, "platform");
  }

  @Post("logout")
  @PublicAccess({ reason: "Current platform session validation is handled by AuthService." })
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Headers("authorization") authorization: string | undefined,
    @Res({ passthrough: true }) response: any,
  ) {
    await this.authService.logout(authorization, response);
  }

  @Get("me")
  @PublicAccess({ reason: "Current platform session validation is handled by AuthService." })
  me(@Headers("authorization") authorization?: string) {
    return this.authService.platformMe(authorization);
  }
}
