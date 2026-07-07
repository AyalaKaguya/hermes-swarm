import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  FEATURE_SETTING_KEYS,
  PlatformMember,
  PLATFORM_SETTING_KEYS,
  RolePermission,
  Ticket,
  TicketMessage,
  type ConversationMessageAttachment,
  type TicketStatus,
  UserOrganization,
} from "@hermes-swarm/core";
import { In, IsNull, LessThanOrEqual, Repository } from "typeorm";
import { AuthSessionService } from "../auth/auth-session.service.js";
import {
  ConversationCapabilityService,
  toConversationMessageDto,
} from "../conversations/conversations.service.js";
import type { ConversationSource } from "../conversations/conversation-access-resolver.js";
import { SettingsService } from "../settings/settings.service.js";
import { TicketConversationAccessResolver } from "./ticket-conversation-access.resolver.js";

const TICKET_SOURCE_TYPE = "ticket";
const ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const ORGANIZATION_TICKETING_FEATURE_KEY = FEATURE_SETTING_KEYS.ticketing;
const ORGANIZATION_TICKET_HANDLING_FEATURE_KEY =
  FEATURE_SETTING_KEYS.ticketingHandling;
const ORGANIZATION_TICKET_HANDLE_PERMISSION =
  "ticket.conversation.handle:organization";
const PLATFORM_TICKET_HANDLE_PERMISSION =
  "ticket.platform_conversation.list_platform:platform";

@Injectable()
export class TicketsService implements OnApplicationBootstrap, OnModuleDestroy {
  private archiveTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(TicketMessage)
    private readonly legacyMessageRepository: Repository<TicketMessage>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(PlatformMember)
    private readonly platformMemberRepository: Repository<PlatformMember>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    @Inject(ConversationCapabilityService)
    private readonly conversationsService: ConversationCapabilityService,
    @Inject(TicketConversationAccessResolver)
    private readonly ticketConversationAccessResolver: TicketConversationAccessResolver,
    @Inject(SettingsService)
    private readonly settingsService: SettingsService,
  ) {}

  onApplicationBootstrap() {
    this.archiveTimer = setInterval(() => {
      void this.archiveExpiredTickets();
    }, 60 * 60 * 1000);
  }

  onModuleDestroy() {
    if (this.archiveTimer) clearInterval(this.archiveTimer);
  }

  async listOrganizationTickets(
    authorization: string | undefined,
    organizationId: string,
    status?: string,
  ) {
    await this.requireTicketingVisible();
    await this.archiveExpiredTickets();
    const session = await this.requireSession(authorization);
    await this.requireOrganizationMember(session.userId, organizationId);
    const canHandle = await this.canHandleOrganizationTickets(
      session.userId,
      organizationId,
    );
    const normalizedStatus = normalizeStatus(status);
    const baseWhere = {
      organizationId,
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
    };
    const participantTicketIds = canHandle
      ? []
      : await this.conversationsService.listParticipantSourceIds({
          organizationId,
          scope: "organization",
          sourceType: TICKET_SOURCE_TYPE,
          userId: session.userId,
        });
    const tickets = await this.ticketRepository.find({
      order: { updatedAt: "DESC" },
      where: canHandle
        ? baseWhere
        : [
            { ...baseWhere, requesterUserId: session.userId },
            ...(participantTicketIds.length > 0
              ? [{ ...baseWhere, id: In(participantTicketIds) }]
              : []),
          ],
    });
    return tickets.map(toTicketDto);
  }

  async createOrganizationTicket(
    authorization: string | undefined,
    organizationId: string,
    payload: unknown,
  ) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    await this.requireOrganizationMember(session.userId, organizationId);
    await this.requireOrganizationTicketingEnabled(session.userId, organizationId);
    const input = parseTicketPayload(payload);
    const now = new Date();
    const ticket = await this.ticketRepository.save(
      this.ticketRepository.create({
        lastMessageAt: now,
        organizationId,
        participantUserIds: [session.userId],
        requesterUserId: session.userId,
        scope: "organization",
        status: "open",
        subject: input.subject,
      }),
    );
    const conversation = await this.ensureTicketConversation(ticket, "creator");
    const message = await this.conversationsService.sendMessage({
      authorUserId: session.userId,
      message: {
        attachments: input.attachments,
        body: input.body,
      },
      resolver: this.ticketConversationAccessResolver,
      source: this.toConversationSource(ticket),
    });
    ticket.lastMessageAt = new Date(String(message.createdAt));
    ticket.conversationId = conversation.id;
    await this.ticketRepository.save(ticket);
    return { ...toTicketDto(ticket), firstMessage: toTicketMessageDto(message) };
  }

  async listPlatformTickets(authorization: string | undefined, status?: string) {
    await this.requireTicketingVisible();
    await this.archiveExpiredTickets();
    const session = await this.requireSession(authorization);
    const canHandle = await this.canHandlePlatformTickets(session.userId);
    const normalizedStatus = normalizeStatus(status);
    const participantTicketIds = canHandle
      ? []
      : await this.conversationsService.listParticipantSourceIds({
          scope: "platform",
          sourceType: TICKET_SOURCE_TYPE,
          userId: session.userId,
        });
    const tickets = await this.ticketRepository.find({
      order: { updatedAt: "DESC" },
      where: canHandle
        ? {
            scope: "platform",
            ...(normalizedStatus ? { status: normalizedStatus } : {}),
          }
        : [
            {
              requesterUserId: session.userId,
              scope: "platform",
              ...(normalizedStatus ? { status: normalizedStatus } : {}),
            },
            ...(participantTicketIds.length > 0
              ? [
                  {
                    id: In(participantTicketIds),
                    scope: "platform" as const,
                    ...(normalizedStatus ? { status: normalizedStatus } : {}),
                  },
                ]
              : []),
          ],
    });
    return tickets.map(toTicketDto);
  }

  async createPlatformTicket(authorization: string | undefined, payload: unknown) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    await this.ensureCanSubmitPlatformTicket(session.userId);
    const input = parseTicketPayload(payload);
    const now = new Date();
    const ticket = await this.ticketRepository.save(
      this.ticketRepository.create({
        lastMessageAt: now,
        participantUserIds: [session.userId],
        requesterUserId: session.userId,
        scope: "platform",
        status: "open",
        subject: input.subject,
      }),
    );
    const conversation = await this.ensureTicketConversation(ticket, "creator");
    const message = await this.conversationsService.sendMessage({
      authorUserId: session.userId,
      message: {
        attachments: input.attachments,
        body: input.body,
      },
      resolver: this.ticketConversationAccessResolver,
      source: this.toConversationSource(ticket),
    });
    ticket.lastMessageAt = new Date(String(message.createdAt));
    ticket.conversationId = conversation.id;
    await this.ticketRepository.save(ticket);
    return { ...toTicketDto(ticket), firstMessage: toTicketMessageDto(message) };
  }

  async getTicket(authorization: string | undefined, ticketId: string) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const ticket = await this.findTicketOrThrow(ticketId);
    await this.requireTicketAccess(session.userId, ticket);
    return toTicketDto(ticket);
  }

  async listMessages(authorization: string | undefined, ticketId: string) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const ticket = await this.findTicketOrThrow(ticketId);
    await this.requireTicketAccess(session.userId, ticket);
    await this.ensureTicketConversation(ticket, "migration");
    const messages = await this.conversationsService.listMessages({
      resolver: this.ticketConversationAccessResolver,
      source: this.toConversationSource(ticket),
      userId: session.userId,
    });
    return messages.map(toTicketMessageDto);
  }

  async sendMessage(
    authorization: string | undefined,
    ticketId: string,
    payload: unknown,
  ) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const ticket = await this.findTicketOrThrow(ticketId);
    await this.requireTicketAccess(session.userId, ticket);
    if (ticket.status === "archived") {
      throw new BadRequestException("工单已归档");
    }

    const input = parseMessagePayload(payload);
    const message = await this.conversationsService.sendMessage({
      authorUserId: session.userId,
      message: {
        attachments: input.attachments,
        body: input.body,
      },
      resolver: this.ticketConversationAccessResolver,
      source: this.toConversationSource(ticket),
    });
    ticket.status = "open";
    ticket.lastMessageAt = new Date(String(message.createdAt));
    if (ticket.requesterUserId === session.userId) {
      ticket.requesterClosedAt = null;
    } else {
      ticket.handlerClosedAt = null;
    }
    await this.ticketRepository.save(ticket);
    await this.conversationsService.publishSourceUpdated(
      this.toConversationSource(ticket),
      toTicketDto(ticket),
    );
    return toTicketMessageDto(message);
  }

  async closeTicket(authorization: string | undefined, ticketId: string) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const ticket = await this.findTicketOrThrow(ticketId);
    await this.requireTicketAccess(session.userId, ticket);
    const now = new Date();
    if (ticket.requesterUserId === session.userId) {
      ticket.requesterClosedAt = now;
    } else {
      ticket.handlerClosedAt = now;
    }
    if (ticket.requesterClosedAt && ticket.handlerClosedAt) {
      ticket.status = "archived";
      ticket.archivedAt = now;
    } else {
      ticket.status = "closed";
    }
    await this.ticketRepository.save(ticket);
    await this.conversationsService.publishSourceUpdated(
      this.toConversationSource(ticket),
      toTicketDto(ticket),
    );
    return toTicketDto(ticket);
  }

  async markTicketRead(authorization: string | undefined, ticketId: string) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const ticket = await this.findTicketOrThrow(ticketId);
    await this.requireTicketAccess(session.userId, ticket);
    return this.conversationsService.markRead({
      resolver: this.ticketConversationAccessResolver,
      source: this.toConversationSource(ticket),
      userId: session.userId,
    });
  }

  async archiveExpiredTickets() {
    const threshold = new Date(Date.now() - ARCHIVE_AFTER_MS);
    const tickets = await this.ticketRepository.find({
      where: [
        {
          archivedAt: IsNull(),
          handlerClosedAt: LessThanOrEqual(threshold),
          requesterClosedAt: IsNull(),
          status: "closed",
        },
        {
          archivedAt: IsNull(),
          handlerClosedAt: IsNull(),
          requesterClosedAt: LessThanOrEqual(threshold),
          status: "closed",
        },
      ],
    });
    const now = new Date();
    for (const ticket of tickets) {
      ticket.status = "archived";
      ticket.archivedAt = now;
    }
    if (tickets.length) {
      await this.ticketRepository.save(tickets);
    }
    return { archived: tickets.length };
  }

  private async findTicketOrThrow(ticketId: string) {
    const ticket = await this.ticketRepository.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException("工单不存在");
    return ticket;
  }

  private async ensureTicketConversation(
    ticket: Ticket,
    joinedReason: "creator" | "migration",
  ) {
    const conversation = await this.conversationsService.ensureConversationForSource(
      this.toConversationSource(ticket),
    );
    if (ticket.conversationId !== conversation.id) {
      ticket.conversationId = conversation.id;
      await this.ticketRepository.save(ticket);
    }
    await this.migrateLegacyMessages(ticket, conversation.id);
    await this.conversationsService.addParticipants({
      conversationId: conversation.id,
      joinedReason,
      userIds: [
        ...new Set(
          [
            ticket.requesterUserId,
            ticket.assigneeUserId,
            ...(ticket.participantUserIds ?? []),
          ].filter((value): value is string => Boolean(value)),
        ),
      ],
    });
    return conversation;
  }

  private async migrateLegacyMessages(ticket: Ticket, conversationId: string) {
    const legacyMessages = await this.legacyMessageRepository.find({
      order: { createdAt: "ASC" },
      where: { ticketId: ticket.id },
    });
    await this.conversationsService.importMessagesIfEmpty({
      conversationId,
      messages: legacyMessages.map((message) => ({
        attachments: message.attachments,
        authorUserId: message.authorUserId,
        body: message.body,
        createdAt: message.createdAt,
        id: message.id,
        kind: message.kind,
        updatedAt: message.updatedAt,
      })),
    });
  }

  private toConversationSource(ticket: Ticket): ConversationSource {
    return {
      organizationId: ticket.organizationId,
      scope: ticket.scope,
      sourceId: ticket.id,
      sourceType: TICKET_SOURCE_TYPE,
      status: ticket.status,
      subject: ticket.subject,
    };
  }

  private async requireTicketAccess(userId: string, ticket: Ticket) {
    if (
      ticket.requesterUserId === userId ||
      ticket.assigneeUserId === userId ||
      ticket.participantUserIds?.includes(userId) ||
      (await this.conversationsService.isParticipant(
        this.toConversationSource(ticket),
        userId,
      ))
    ) {
      return;
    }
    if (ticket.scope === "platform") {
      await this.requirePlatformMember(userId);
      return;
    }
    if (
      ticket.organizationId &&
      (await this.canHandleOrganizationTickets(userId, ticket.organizationId))
    ) {
      return;
    }
    throw new ForbiddenException("没有访问该工单的权限");
  }

  private async requireSession(authorization: string | undefined) {
    try {
      return await this.authSessionService.validateAccessToken(
        authorization?.replace(/^Bearer\s+/i, "").trim(),
      );
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
  }

  private async requireOrganizationMember(userId: string, organizationId: string) {
    const membership = await this.membershipRepository.findOne({
      where: { organizationId, status: "active", userId },
    });
    if (!membership) throw new ForbiddenException("不是当前组织成员");
    return membership;
  }

  private async requirePlatformMember(userId: string) {
    if (await this.canHandlePlatformTickets(userId)) return;
    throw new ForbiddenException("没有处理平台工单的权限");
  }

  private async requireTicketingVisible() {
    const enabled = await this.getPlatformBooleanSetting(
      PLATFORM_SETTING_KEYS.ticketingVisible,
      true,
    );
    if (!enabled) throw new ForbiddenException("工单功能已关闭");
  }

  private async requireOrganizationTicketingEnabled(
    userId: string,
    organizationId: string,
  ) {
    const value = await this.settingsService.getOrganizationValue(
      organizationId,
      ORGANIZATION_TICKETING_FEATURE_KEY,
      "true",
    );
    if (value === "true" || (await this.isOrganizationOwner(userId, organizationId))) {
      return;
    }
    throw new ForbiddenException("当前组织未启用工单功能");
  }

  private async ensureCanSubmitPlatformTicket(userId: string) {
    const enabled = await this.getPlatformBooleanSetting(
      PLATFORM_SETTING_KEYS.ticketingPlatformSubmissionEnabled,
      true,
    );
    if (
      enabled ||
      (await this.canHandlePlatformTickets(userId)) ||
      (await this.isAnyOrganizationOwner(userId))
    ) {
      return;
    }
    throw new ForbiddenException("平台工单提交已关闭");
  }

  private async getPlatformBooleanSetting(name: string, fallback: boolean) {
    const value = await this.settingsService.getPlatformValue(
      name,
      fallback ? "true" : "false",
    );
    if (value === "true") return true;
    if (value === "false") return false;
    return fallback;
  }

  private async canHandleOrganizationTickets(userId: string, organizationId: string) {
    if (!(await this.isOrganizationTicketHandlingEnabled(organizationId))) {
      return false;
    }
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

  private async isOrganizationTicketHandlingEnabled(organizationId: string) {
    const value = await this.settingsService.getOrganizationValue(
      organizationId,
      ORGANIZATION_TICKET_HANDLING_FEATURE_KEY,
      "true",
    );
    return value !== "false";
  }

  private async isOrganizationOwner(userId: string, organizationId: string) {
    const membership = await this.membershipRepository.findOne({
      relations: { role: true },
      where: { organizationId, status: "active", userId },
    });
    return membership?.role?.name === "owner";
  }

  private async isAnyOrganizationOwner(userId: string) {
    const memberships = await this.membershipRepository.find({
      relations: { role: true },
      where: { status: "active", userId },
    });
    return memberships.some((membership) => membership.role?.name === "owner");
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

function parseTicketPayload(payload: unknown) {
  const value = assertObject(payload);
  return {
    ...parseMessagePayload(payload),
    subject: requireText(value.subject, "工单标题").slice(0, 240),
  };
}

function parseMessagePayload(payload: unknown) {
  const value = assertObject(payload);
  return {
    attachments: parseAttachments(value.attachments),
    body: requireText(value.body, "消息内容"),
  };
}

function assertObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("请求内容无效");
  }
  return value as Record<string, unknown>;
}

function requireText(value: unknown, label: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${label}不能为空`);
  }
  return value.trim();
}

function parseAttachments(value: unknown): ConversationMessageAttachment[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new BadRequestException("附件格式无效");
  return value.map((item) => {
    const attachment = assertObject(item);
    const url = requireText(attachment.url, "附件地址");
    const name = requireText(attachment.name, "附件名称");
    const type = attachment.type === "image" ? "image" : null;
    if (!type) throw new BadRequestException("仅支持图片附件");
    return {
      mimeType:
        typeof attachment.mimeType === "string" ? attachment.mimeType : undefined,
      name,
      size:
        typeof attachment.size === "number" && Number.isFinite(attachment.size)
          ? attachment.size
          : undefined,
      type,
      url,
    };
  });
}

function normalizeStatus(value: string | undefined): TicketStatus | undefined {
  return value === "open" || value === "closed" || value === "archived"
    ? value
    : undefined;
}

function toTicketDto(ticket: Ticket) {
  return {
    archivedAt: ticket.archivedAt,
    assigneeUserId: ticket.assigneeUserId,
    conversationId: ticket.conversationId,
    createdAt: ticket.createdAt,
    handlerClosedAt: ticket.handlerClosedAt,
    id: ticket.id,
    lastMessageAt: ticket.lastMessageAt,
    organizationId: ticket.organizationId,
    participantUserIds: ticket.participantUserIds ?? [],
    requesterClosedAt: ticket.requesterClosedAt,
    requesterUserId: ticket.requesterUserId,
    scope: ticket.scope,
    status: ticket.status,
    subject: ticket.subject,
    updatedAt: ticket.updatedAt,
  };
}

type ConversationMessageDto = ReturnType<typeof toConversationMessageDto>;

function toTicketMessageDto(message: ConversationMessageDto) {
  return {
    attachments: message.attachments,
    author: message.author,
    authorUserId: message.authorUserId,
    body: message.body,
    conversationId: message.conversationId,
    createdAt: message.createdAt,
    id: message.id,
    kind: message.kind,
    metadata: message.metadata,
    sourceId: message.sourceId,
    sourceType: message.sourceType,
    ticketId: message.sourceId,
    updatedAt: message.updatedAt,
  };
}
