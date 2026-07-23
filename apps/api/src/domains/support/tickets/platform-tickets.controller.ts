import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { TicketsService } from "./tickets.service.js";

type PlatformTicketRequest = {
  accessPrincipal?: {
    principalType?: "integration" | "platform" | "workspace";
    userId?: string;
  };
};

@Controller("admin/platform/tickets")
@AccessResource({
  entity: "ticket",
  entityLabel: "工单",
  entityOrder: 90,
  purpose: "conversation",
  purposeLabel: "工单会话",
  scope: "platform",
})
export class PlatformTicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "查看平台工单",
    operation: "list",
  })
  list(@Req() request: PlatformTicketRequest, @Query("status") status?: string) {
    return this.ticketsService.listPlatformTickets(
      requirePlatformAccountId(request),
      { status },
    );
  }

  @Get(":ticketId")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "查看平台工单详情",
    operation: "view",
  })
  get(@Req() request: PlatformTicketRequest, @Param("ticketId") ticketId: string) {
    return this.ticketsService.getPlatformTicket(
      requirePlatformAccountId(request),
      ticketId,
    );
  }

  @Get(":ticketId/messages")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "查看平台工单消息",
    operation: "list_messages",
  })
  messages(
    @Req() request: PlatformTicketRequest,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.listPlatformMessages(
      requirePlatformAccountId(request),
      ticketId,
    );
  }

  @Post(":ticketId/messages")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "回复平台工单",
    operation: "send_message",
  })
  sendMessage(
    @Req() request: PlatformTicketRequest,
    @Param("ticketId") ticketId: string,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.sendPlatformMessage(
      requirePlatformAccountId(request),
      ticketId,
      payload,
    );
  }

  @Patch(":ticketId/close")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "关闭平台工单",
    operation: "close",
  })
  close(
    @Req() request: PlatformTicketRequest,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.closePlatformTicket(
      requirePlatformAccountId(request),
      ticketId,
    );
  }

  @Patch(":ticketId/read")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    label: "标记平台工单已读",
    operation: "mark_read",
  })
  markRead(
    @Req() request: PlatformTicketRequest,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.markPlatformTicketRead(
      requirePlatformAccountId(request),
      ticketId,
    );
  }
}

function requirePlatformAccountId(request: PlatformTicketRequest) {
  if (request.accessPrincipal?.principalType !== "platform") {
    throw new Error("Platform principal was not established by the access guard.");
  }
  const accountId = request.accessPrincipal.userId?.trim();
  if (!accountId) {
    throw new Error("Platform principal is missing an id.");
  }
  return accountId;
}
