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
} from "../../common/admin-api.types.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import {
  AccessOperation,
  AccessResource,
  PublicAccess,
} from "@hermes-swarm/rbac";
import { InviteService } from "./invite.service.js";

@Controller("admin")
@AccessResource({
  entity: "invite",
  entityLabel: "邀请",
  entityOrder: 70,
  purpose: "organization_invite",
  purposeLabel: "组织邀请",
  purposeOrder: 10,
  scope: "organization",
})
export class InviteController {
  constructor(
    private readonly inviteService: InviteService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  @Get("organizations/:organizationId/invites")
  @AccessOperation({
    description: "查看当前组织的邀请列表。",
    label: "查看邀请",
    operation: "list",
    sortOrder: 10,
  })
  @RequireFeature("feature:invite:enabled")
  async listForOrganization(@Param("organizationId") organizationId: string) {
    return this.inviteService.listForOrganization(organizationId);
  }

  @Post("organizations/:organizationId/invites")
  @AccessOperation({
    description: "批量创建当前组织的邀请。",
    label: "创建邀请",
    operation: "create_bulk",
    sortOrder: 20,
  })
  @RequireFeature("feature:invite:enabled")
  async createBulkForOrganization(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: CreateBulkInvitesPayload,
  ) {
    return this.inviteService.createBulkForOrganization(
      organizationId,
      await requireSessionUserId(this.authSessionService, authorization),
      payload,
    );
  }

  @Post("organizations/:organizationId/invites/:inviteId/resend")
  @AccessOperation({
    description: "重新发送当前组织的邀请。",
    label: "重发邀请",
    operation: "resend",
    sortOrder: 30,
  })
  @RequireFeature("feature:invite:enabled")
  async resendForOrganization(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Param("inviteId") inviteId: string,
  ) {
    return this.inviteService.resendForOrganization(
      organizationId,
      await requireSessionUserId(this.authSessionService, authorization),
      inviteId,
    );
  }

  @Delete("organizations/:organizationId/invites/:inviteId")
  @AccessOperation({
    description: "撤销或删除当前组织的邀请。",
    isDangerous: true,
    label: "删除邀请",
    operation: "delete",
    sortOrder: 90,
  })
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
  @PublicAccess({ reason: "Invite validation begins before the invitee has a session." })
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
  @PublicAccess({ reason: "An invite token authorizes acceptance before sign-in." })
  async accept(@Body() payload: AcceptInvitePayload) {
    return this.inviteService.accept(payload);
  }
}

async function requireSessionUserId(
  authSessionService: AuthSessionService,
  authorization: string | undefined,
) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  try {
    const session = await authSessionService.validateAccessToken(token);
    return session.userId;
  } catch {
    throw new UnauthorizedException("登录已失效，请重新登录");
  }
}
