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
import type {
  LoginPayload,
  SelectContextPayload,
} from "../../common/admin-api.types.js";
import { PublicAccess } from "@hermes-swarm/rbac";
import { AuthService } from "./auth.service.js";
import { WorkspaceLoginResolverService } from "./workspace-login-resolver.service.js";
import {
  AuthRateLimitService,
  rateLimitHash,
  requestIp,
} from "../../common/security/auth-rate-limit.service.js";

@Controller("admin/auth")
/**
 * Provides auth-focused admin endpoints under `/api/admin/auth`.
 */
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly workspaceLoginResolver: WorkspaceLoginResolverService,
    private readonly rateLimiter: AuthRateLimitService,
  ) {}

  @Post("workspace-context")
  @PublicAccess({ reason: "Workspace workspace discovery happens before login." })
  async workspaceContext(
    @Body() payload: { workspace?: string } | null,
    @Req() request: any,
  ) {
    await this.rateLimiter.assertAllowed([
      { key: `workspace-context:ip:${rateLimitHash(requestIp(request))}`, limit: 60, windowSeconds: 60 },
    ]);
    const workspace = payload?.workspace;
    const resolution = await this.workspaceLoginResolver.resolve(request, workspace);
    if (workspace?.trim() && !resolution) {
      return { source: null, workspace: null };
    }
    return this.workspaceLoginResolver.toPublicContext(resolution);
  }

  /**
   * Starts an admin session with email and password credentials.
   */
  @Post("login")
  @PublicAccess({ reason: "Credential validation is handled by AuthService." })
  async login(
    @Body() payload: LoginPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    await this.rateLimiter.assertAllowed(loginRules(payload, request, "account"), response);
    return this.authService.login(payload, request, response);
  }

  @Post("select-context")
  @PublicAccess({ reason: "One-time context selection token validation is handled by AuthService." })
  selectContext(
    @Body() payload: SelectContextPayload,
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    return this.authService.selectContext(payload, request, response);
  }

  @Get("contexts")
  @PublicAccess({ reason: "Current account session validation is handled by AuthService." })
  contexts(@Headers("authorization") authorization?: string) {
    return this.authService.listAccountContexts(authorization);
  }

  @Post("switch-context")
  @PublicAccess({ reason: "Current account session and target membership are validated by AuthService." })
  switchContext(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: { contextType?: string; membershipId?: string },
    @Req() request: any,
    @Res({ passthrough: true }) response: any,
  ) {
    return this.authService.switchContext(
      authorization,
      payload,
      request,
      response,
    );
  }

  @Post("refresh")
  @PublicAccess({ reason: "Refresh cookie validation is handled by AuthService." })
  async refresh(@Req() request: any, @Res({ passthrough: true }) response: any) {
    await this.rateLimiter.assertAllowed(refreshRules(request), response);
    return this.authService.refresh(request, response);
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

function loginRules(payload: LoginPayload, request: any, scope: string) {
  const ip = rateLimitHash(requestIp(request));
  const account = rateLimitHash(
    `${scope}:${payload?.workspaceSlug ?? ""}:${payload?.email ?? ""}`,
  );
  return [
    { key: `login:ip:${ip}`, limit: 30, windowSeconds: 300 },
    { key: `login:account:${account}`, limit: 5, windowSeconds: 300 },
  ];
}

function refreshRules(request: any) {
  const ip = rateLimitHash(requestIp(request));
  const cookie = rateLimitHash(request?.headers?.cookie ?? "");
  return [
    { key: `refresh:${cookie}:${ip}`, limit: 60, windowSeconds: 60 },
  ];
}
