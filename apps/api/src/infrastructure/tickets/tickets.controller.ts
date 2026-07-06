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

  @Get("tickets/platform")
  listPlatformTickets(
    @Headers("authorization") authorization: string | undefined,
    @Query("status") status?: string,
  ) {
    return this.ticketsService.listPlatformTickets(authorization, status);
  }

  @Post("tickets/platform")
  createPlatformTicket(
    @Headers("authorization") authorization: string | undefined,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.createPlatformTicket(authorization, payload);
  }

  @Get("tickets/platform/handler-capability")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    description: "允许查看和处理平台运营范围内的全部工单。",
    entity: "ticket",
    entityLabel: "工单",
    label: "处理平台工单",
    operation: "list_platform",
    purpose: "platform_conversation",
    purposeLabel: "平台工单",
    scope: "platform",
    sortOrder: 10,
  })
  platformHandlerCapability() {
    return { ok: true };
  }

  @Get("organizations/:organizationId/tickets/handler-capability")
  @AccessOperation({
    defaultRoles: ["owner", "admin"],
    description: "允许处理当前组织内成员提交的工单。",
    label: "处理组织工单",
    operation: "handle",
    sortOrder: 30,
  })
  organizationHandlerCapability() {
    return { ok: true };
  }

  @Get("tickets/:ticketId")
  getTicket(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.getTicket(authorization, ticketId);
  }

  @Get("tickets/:ticketId/messages")
  listMessages(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.listMessages(authorization, ticketId);
  }

  @Post("tickets/:ticketId/messages")
  sendMessage(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
    @Body() payload: unknown,
  ) {
    return this.ticketsService.sendMessage(authorization, ticketId, payload);
  }

  @Patch("tickets/:ticketId/close")
  closeTicket(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.closeTicket(authorization, ticketId);
  }

  @Patch("tickets/:ticketId/read")
  markTicketRead(
    @Headers("authorization") authorization: string | undefined,
    @Param("ticketId") ticketId: string,
  ) {
    return this.ticketsService.markTicketRead(authorization, ticketId);
  }

  @Post("tickets/archive-expired")
  @AccessOperation({
    defaultRoles: ["platform-admin"],
    description: "归档超过 7 天只有单方关闭的工单。",
    entity: "ticket",
    entityLabel: "工单",
    label: "归档过期工单",
    operation: "archive_expired",
    purpose: "platform_conversation",
    purposeLabel: "平台工单",
    scope: "platform",
    sortOrder: 90,
  })
  archiveExpiredTickets() {
    return this.ticketsService.archiveExpiredTickets();
  }
}
