import {
  Body,
  Controller,
  Get,
  Headers,
  Inject,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { AccessOperation, AccessResource } from "@hermes-swarm/rbac";
import { TicketsService } from "./tickets.service.js";

@Controller("admin")
@AccessResource({
  entity: "ticket",
  entityLabel: "工单",
  entityOrder: 90,
  purpose: "conversation",
  purposeLabel: "工单会话",
  purposeOrder: 10,
  scope: "organization",
})
export class TicketsController {
  constructor(@Inject(TicketsService) private readonly ticketsService: TicketsService) {}

  @Get("organizations/:organizationId/tickets")
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member", "viewer"],
    description: "查看当前组织内自己参与或有权处理的工单。",
    label: "查看组织工单",
    operation: "list_organization",
    sortOrder: 10,
  })
  listOrganizationTickets(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Query("status") status?: string,
  ) {
    return this.ticketsService.listOrganizationTickets(
      authorization,
      organizationId,
      status,
    );
  }

  @Post("organizations/:organizationId/tickets")
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member", "viewer"],
    description: "向当前组织管理员发起工单。",
    label: "创建组织工单",
    operation: "create_organization",
    sortOrder: 20,
  })
  createOrganizationTicket(
    @Headers("authorization") authorization: string | undefined,
    @Param("organizationId") organizationId: string,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.createOrganizationTicket(
      authorization,
      organizationId,
      payload,
    );
  }

  @Get("tickets/tenant")
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member", "viewer"],
    description: "查看当前账号参与的租户支持工单。",
    label: "查看租户工单",
    operation: "list_tenant",
    purpose: "tenant_conversation",
    purposeLabel: "租户工单",
    scope: "own",
    sortOrder: 10,
  })
  listTenantTickets(
    @Headers("authorization") authorization: string | undefined,
    @Query("status") status?: string,
  ) {
    return this.ticketsService.listTenantTickets(authorization, status);
  }

  @Post("tickets/tenant")
  @AccessOperation({
    defaultRoles: ["owner", "admin", "member", "viewer"],
    description: "向当前租户支持团队发起工单。",
    label: "创建租户工单",
    operation: "create_tenant",
    purpose: "tenant_conversation",
    purposeLabel: "租户工单",
    scope: "own",
    sortOrder: 20,
  })
  createTenantTicket(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.createTenantTicket(authorization, payload);
  }


  @Get("tickets/:ticketId")
  @AccessOperation({
    description: "查看当前账号有权访问的工单详情。",
    label: "查看工单详情",
    operation: "view",
    scope: "own",
    sortOrder: 40,
  })
  getTicket(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.getTicket(authorization, ticketId);
  }

  @Get("tickets/:ticketId/messages")
  @AccessOperation({
    description: "查看当前账号有权访问的工单消息。",
    label: "查看工单消息",
    operation: "list_messages",
    scope: "own",
    sortOrder: 50,
  })
  listMessages(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.listMessages(authorization, ticketId);
  }

  @Post("tickets/:ticketId/messages")
  @AccessOperation({
    description: "向当前账号有权访问的工单发送消息。",
    label: "发送工单消息",
    operation: "send_message",
    scope: "own",
    sortOrder: 60,
  })
  sendMessage(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.sendMessage(authorization, ticketId, payload);
  }

  @Patch("tickets/:ticketId/close")
  @AccessOperation({
    description: "关闭当前账号有权处理的工单。",
    label: "关闭工单",
    operation: "close",
    scope: "own",
    sortOrder: 70,
  })
  closeTicket(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.closeTicket(authorization, ticketId);
  }

  @Patch("tickets/:ticketId/read")
  @AccessOperation({
    description: "标记当前账号有权访问的工单为已读。",
    label: "标记工单已读",
    operation: "mark_read",
    scope: "own",
    sortOrder: 80,
  })
  markTicketRead(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.markTicketRead(authorization, ticketId);
  }

}
