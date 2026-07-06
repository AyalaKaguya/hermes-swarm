import { Inject, Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  PlatformMember,
  RolePermission,
  Ticket,
  UserOrganization,
} from "@hermes-swarm/core";
import { Repository } from "typeorm";
import type {
  ConversationAccessResolver,
  ConversationSource,
} from "../conversations/conversation-access-resolver.js";
import { ConversationCapabilityService } from "../conversations/conversations.service.js";

const ORGANIZATION_TICKET_HANDLE_PERMISSION =
  "ticket.conversation.handle:organization";
const PLATFORM_TICKET_HANDLE_PERMISSION =
  "ticket.platform_conversation.list_platform:platform";

@Injectable()
export class TicketConversationAccessResolver implements ConversationAccessResolver {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @Inject(ConversationCapabilityService)
    private readonly conversationsService: ConversationCapabilityService,
  ) {}

  async canRead(userId: string, source: ConversationSource) {
    const ticket = await this.findTicket(source);
    if (!ticket) return false;
    if (
      ticket.requesterUserId === userId ||
      ticket.assigneeUserId === userId ||
      ticket.participantUserIds?.includes(userId) ||
      (await this.conversationsService.isParticipant(source, userId))
    ) {
      return true;
    }
    if (ticket.scope === "platform") return this.canHandlePlatformTickets(userId);
    return ticket.organizationId
      ? this.canHandleOrganizationTickets(userId, ticket.organizationId)
      : false;
  }

  async canWrite(userId: string, source: ConversationSource) {
    return this.canRead(userId, source);
  }

  buildNotificationPayload(input: Parameters<NonNullable<ConversationAccessResolver["buildNotificationPayload"]>>[0]) {
    return input.kind === "mention"
      ? {
          body: input.message.body,
          title: `有人在工单中提到了你：${input.source.subject}`,
        }
      : {
          body: input.message.body,
          title: `工单新消息：${input.source.subject}`,
        };
  }

  private findTicket(source: ConversationSource) {
    if (source.sourceType !== "ticket") return null;
    return this.ticketRepository.findOne({ where: { id: source.sourceId } });
  }

  private async canHandleOrganizationTickets(userId: string, organizationId: string) {
    const membership = await this.membershipRepository.findOne({
      where: { organizationId, status: "active", userId },
    });
    return membership?.roleId
      ? this.roleHasPermission(
          membership.roleId,
          ORGANIZATION_TICKET_HANDLE_PERMISSION,
        )
      : false;
  }

  private async canHandlePlatformTickets(userId: string) {
    const member = await this.platformMemberRepository.findOne({
      where: { status: "active", userId },
    });
    return member?.roleId
      ? this.roleHasPermission(member.roleId, PLATFORM_TICKET_HANDLE_PERMISSION)
      : false;
  }

  private async roleHasPermission(roleId: string, permission: string) {
    return Boolean(
      await this.rolePermissionRepository.findOne({
        where: {
          enabled: true,
          permission,
          roleId,
        },
      }),
    );
  }
}
