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
  UnauthorizedException,
} from "@nestjs/common";
import type {
  AcceptInvitePayload,
  CreateBulkInvitesPayload,
} from "../common/admin-api.types.js";
import { parseAuthSessionToken } from "../auth/auth-session.js";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import { RequirePermission } from "../rbac/require-permission.decorator.js";
import { InviteService } from "./invite.service.js";

@Controller("admin")
export class InviteController {
  constructor(private readonly inviteService: InviteService) {}

  @Get("organizations/:organizationId/invites")
  @RequirePermission({ action: "read", entity: "invite", scope: "organization" })
  @RequireFeature("feature:invite:enabled")
  async listForOrganization(@Param("organizationId") organizationId: string) {
    return this.inviteService.listForOrganization(organizationId);
  }

  @Post("organizations/:organizationId/invites")
  @RequirePermission({ action: "create", entity: "invite", scope: "organization" })
  @RequireFeature("feature:invite:enabled")
  async createBulkForOrganization(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: CreateBulkInvitesPayload,
  ) {
    return this.inviteService.createBulkForOrganization(
      organizationId,
      requireSessionUserId(authorization),
      payload,
    );
  }

  @Post("organizations/:organizationId/invites/:inviteId/resend")
  @RequirePermission({ action: "update", entity: "invite", scope: "organization" })
  @RequireFeature("feature:invite:enabled")
  async resendForOrganization(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("inviteId") inviteId: string,
  ) {
    return this.inviteService.resendForOrganization(
      organizationId,
      requireSessionUserId(authorization),
      inviteId,
    );
  }

  @Delete("organizations/:organizationId/invites/:inviteId")
  @RequirePermission({ action: "delete", entity: "invite", scope: "organization" })
  @RequireFeature("feature:invite:enabled")
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteForOrganization(
    @Param("organizationId") organizationId: string,
    @Param("inviteId") inviteId: string,
  ) {
    await this.inviteService.deleteForOrganization(organizationId, inviteId);
  }

  /**
   * Public endpoint to validate an invite token.
   */
  @Post("invites/validate")
  async validate(
    @Body("email") email?: string,
    @Body("token") token?: string,
  ) {
    return this.inviteService.validateByToken(email, token);
  }

  /**
   * Public endpoint to accept an invite and register the user.
   */
  @Post("invites/accept")
  async accept(@Body() payload: AcceptInvitePayload) {
    return this.inviteService.accept(payload);
  }
}

function requireSessionUserId(authorization: string | undefined) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  const session = parseAuthSessionToken(token);
  if (!session) throw new UnauthorizedException("登录已失效，请重新登录");
  return session.userId;
}
