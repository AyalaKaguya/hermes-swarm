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
} from "@nestjs/common";
import type {
  AcceptInvitePayload,
  CreateBulkInvitesPayload,
} from "../tenancy/tenancy.types.js";
import { TenancyService } from "../tenancy/tenancy.service.js";
import { InviteService } from "./invite.service.js";

@Controller("admin/invites")
export class InviteController {
  constructor(
    private readonly inviteService: InviteService,
    private readonly tenancyService: TenancyService,
  ) {}

  /**
   * Lists invites in the current organization.
   */
  @Get()
  async list(@Headers("authorization") authorization?: string) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.inviteService.list(context);
  }

  /**
   * Creates bulk email invites for the current organization.
   */
  @Post()
  async createBulk(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: CreateBulkInvitesPayload,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.inviteService.createBulk(context, payload);
  }

  /**
   * Resends an existing invite by regenerating the token.
   */
  @Post(":inviteId/resend")
  async resend(
    @Headers("authorization") authorization: string | undefined,
    @Param("inviteId") inviteId: string,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    return this.inviteService.resend(context, inviteId);
  }

  /**
   * Deletes an invite.
   */
  @Delete(":inviteId")
  @HttpCode(HttpStatus.NO_CONTENT)
  async delete(
    @Headers("authorization") authorization: string | undefined,
    @Param("inviteId") inviteId: string,
  ) {
    const context = await this.tenancyService.requireAuthContext(authorization);
    await this.inviteService.delete(context, inviteId);
  }

  /**
   * Public endpoint to validate an invite token.
   */
  @Post("validate")
  async validate(
    @Body("email") email?: string,
    @Body("token") token?: string,
  ) {
    return this.inviteService.validateByToken(email, token);
  }

  /**
   * Public endpoint to accept an invite and register the user.
   */
  @Post("accept")
  async accept(@Body() payload: AcceptInvitePayload) {
    return this.inviteService.accept(payload);
  }
}
