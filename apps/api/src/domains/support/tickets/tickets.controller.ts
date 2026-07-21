import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { TicketsService } from "./tickets.service.js";

@Controller("admin/tickets")
@AccessResource({
  entity: "ticket",
  entityLabel: "工单",
  entityOrder: 90,
  purpose: "conversation",
  purposeLabel: "工单会话",
  scope: "workspace",
})
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    label: "查看工单",
    operation: "list",
    scope: "own",
  })
  list(
    @Headers("authorization") authorization: string | undefined,
    @Query("status") status?: string,
  ) {
    return this.ticketsService.listTickets(authorization, { status });
  }

  @Post()
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin", "workspace-member"],
    label: "提交工单",
    operation: "submit",
  })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.createTicket(authorization, payload);
  }

  @Get("handling-capability")
  @AccessOperation({
    defaultRoles: ["workspace-owner", "workspace-admin"],
    label: "处理工单",
    operation: "handle",
  })
  handlingCapability(
    @Headers("authorization") authorization: string | undefined,
  ) {
    return this.ticketsService.handlingCapability(authorization);
  }

  @Get(":ticketId")
  @AccessOperation({ label: "查看工单详情", operation: "view", scope: "own" })
  get(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.getTicket(authorization, ticketId);
  }

  @Get(":ticketId/messages")
  @AccessOperation({ label: "查看工单消息", operation: "list_messages", scope: "own" })
  messages(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.listMessages(authorization, ticketId);
  }

  @Post(":ticketId/messages")
  @AccessOperation({ label: "发送工单消息", operation: "send_message", scope: "own" })
  sendMessage(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.sendMessage(authorization, ticketId, payload);
  }

  @Patch(":ticketId/close")
  @AccessOperation({ label: "关闭工单", operation: "close", scope: "own" })
  close(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.closeTicket(authorization, ticketId);
  }

  @Patch(":ticketId/read")
  @AccessOperation({ label: "标记工单已读", operation: "mark_read", scope: "own" })
  markRead(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.markTicketRead(authorization, ticketId);
  }
}
