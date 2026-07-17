import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from "@nestjs/common";
import { AccessOperation, AccessResource, AccessScope } from "@hermes-swarm/rbac";
import { TicketsService } from "./tickets.service.js";
import { TicketAccessScopeResolver } from "./ticket-access-scope.resolver.js";

@Controller("admin/tickets")
@AccessResource({
  entity: "ticket",
  entityLabel: "工单",
  entityOrder: 90,
  purpose: "conversation",
  purposeLabel: "工单会话",
  scope: "organization",
})
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Get()
  @AccessOperation({
    defaultRoles: ["tenant-owner", "tenant-admin", "tenant-member"],
    label: "查看工单",
    operation: "list",
    scope: "own",
  })
  list(
    @Headers("authorization") authorization: string | undefined,
    @Query("sourceOrganizationId") sourceOrganizationId?: string,
    @Query("status") status?: string,
  ) {
    return this.ticketsService.listTickets(authorization, { sourceOrganizationId, status });
  }

  @Post()
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member"],
    label: "提交工单",
    operation: "submit",
  })
  @AccessScope({ resolver: TicketAccessScopeResolver })
  create(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.createTicket(authorization, payload);
  }

  @Get("handling-capability")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    label: "处理工单",
    operation: "handle",
  })
  @AccessScope({ resolver: TicketAccessScopeResolver })
  handlingCapability(
    @Headers("authorization") authorization: string | undefined,
    @Query("organizationId") organizationId?: string,
  ) {
    return this.ticketsService.handlingCapability(authorization, organizationId);
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
