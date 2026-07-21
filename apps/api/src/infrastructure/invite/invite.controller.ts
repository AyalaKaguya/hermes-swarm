import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { AccessOperation, AccessResource, PublicAccess } from "@hermes-swarm/rbac";
import type {
  AcceptInvitePayload,
  CreateInvitePayload,
} from "../../common/admin-api.types.js";
import { AuthSessionService } from "../auth/auth-session.service.js";
import { RequireFeature } from "../feature-access/require-feature.decorator.js";
import { InviteService } from "./invite.service.js";

@Controller("admin/invites")
@AccessResource({
  entity: "invite",
  entityLabel: "邀请",
  entityOrder: 70,
  purpose: "workspace_invite",
  purposeLabel: "工作空间邀请",
  purposeOrder: 10,
  scope: "workspace",
})
export class InviteController {
  constructor(
    @Inject(InviteService)
    private readonly inviteService: InviteService,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
  ) {}

  @Get()
  @AccessOperation({ label: "查看邀请", operation: "list", sortOrder: 10 })
  @RequireFeature("feature:invite:enabled")
  list() {
    return this.inviteService.list();
  }

  @Post()
  @AccessOperation({ label: "创建邀请", operation: "create", sortOrder: 20 })
  @RequireFeature("feature:invite:enabled")
  async create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateInvitePayload,
  ) {
    return this.inviteService.create(
      await requireSessionUserId(this.authSessionService, authorization),
      payload,
    );
  }

  @Post(":inviteId/resend")
  @AccessOperation({ label: "重发邀请", operation: "resend", sortOrder: 30 })
  @RequireFeature("feature:invite:enabled")
  async resend(
    @Headers("authorization") authorization: string | undefined,
    @Param("inviteId") inviteId: string,
  ) {
    return this.inviteService.resend(
      inviteId,
      await requireSessionUserId(this.authSessionService, authorization),
    );
  }

  @Delete(":inviteId")
  @AccessOperation({ isDangerous: true, label: "撤销邀请", operation: "delete", sortOrder: 90 })
  @RequireFeature("feature:invite:enabled")
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(@Param("inviteId") inviteId: string) {
    await this.inviteService.revoke(inviteId);
  }

  @Post("validate")
  @PublicAccess({ reason: "Invite validation begins before the invitee has a session." })
  validate(@Body("email") email?: string, @Body("token") token?: string) {
    return this.inviteService.validateByToken(email, token);
  }

  @Post("accept")
  @PublicAccess({ reason: "An invite token authorizes acceptance before sign-in." })
  accept(
    @Body() payload: AcceptInvitePayload,
    @Headers("authorization") authorization?: string,
  ) {
    return this.inviteService.accept(payload, authorization);
  }
}

async function requireSessionUserId(
  authSessionService: AuthSessionService,
  authorization: string | undefined,
) {
  const token = authorization?.replace(/^Bearer\s+/i, "").trim();
  try {
    return (await authSessionService.validateAccessToken(token)).userId;
  } catch {
    throw new UnauthorizedException("登录已失效，请重新登录");
  }
}
