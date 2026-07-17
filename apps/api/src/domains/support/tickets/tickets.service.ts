import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import {
  Organization,
  RolePermission,
  Ticket,
  UserOrganization,
  UserOrganizationRole,
  type ConversationMessageAttachment,
  type TicketStatus,
} from "@hermes-swarm/core";
import { LessThan } from "typeorm";
import { TenantContextService } from "../../../common/database/tenant-context.service.js";
import { AuthSessionService } from "../../../infrastructure/auth/auth-session.service.js";
import type {
  ConversationAccessResolver,
  ConversationSource,
} from "../conversations/conversation-access-resolver.js";
import {
  ConversationCapabilityService,
  toConversationMessageDto,
} from "../conversations/conversations.service.js";

const TICKET_SOURCE_TYPE = "ticket";
const TICKET_SUBMIT_PERMISSION = "ticket.conversation.submit:organization";
const TICKET_HANDLE_PERMISSION = "ticket.conversation.handle:organization";
const MAX_TICKET_ATTACHMENTS = 6;
const MAX_TICKET_ATTACHMENT_SIZE = 2 * 1024 * 1024;

@Injectable()
export class TicketsService {
  private readonly conversationResolver: ConversationAccessResolver = {
    canRead: (userId, source) => this.canAccessSource(userId, source),
    canWrite: (userId, source) => this.canAccessSource(userId, source),
    buildNotificationPayload: ({ kind, message, source }) => ({
      body: message.body,
      title:
        kind === "mention"
          ? `有人在工单中提到了你：${source.subject}`
          : `工单新消息：${source.subject}`,
    }),
  };

  constructor(
    @Inject(AuthSessionService)
    private readonly authSessionService: AuthSessionService,
    @Inject(ConversationCapabilityService)
    private readonly conversationsService: ConversationCapabilityService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async listTickets(
    authorization: string | undefined,
    options: { sourceOrganizationId?: string; status?: string } = {},
  ) {
    const session = await this.requireTenantSession(authorization);
    const status = parseOptionalTicketStatus(options.status);
    const tickets = await this.tickets.find({
      order: { updatedAt: "DESC" },
      relations: { assigneeUser: true, requesterUser: true, sourceOrganization: true },
      where: {
        ...(options.sourceOrganizationId
          ? { sourceOrganizationId: options.sourceOrganizationId }
          : {}),
        ...(status ? { status } : {}),
        tenantId: session.tenantId,
      },
    });
    const visible: Ticket[] = [];
    for (const ticket of tickets) {
      if (await this.canAccessTicket(session.userId, ticket)) visible.push(ticket);
    }
    return visible.map(toTicketDto);
  }

  async createTicket(authorization: string | undefined, payload: unknown) {
    const session = await this.requireTenantSession(authorization);
    const input = parseCreateTicketPayload(payload);
    const membership = await this.requireActiveMembership(
      session.tenantId,
      session.userId,
      input.sourceOrganizationId,
    );
    await this.requireOrganizationPermission(
      membership,
      TICKET_SUBMIT_PERMISSION,
    );
    const organization = await this.organizations.findOne({
      where: {
        id: input.sourceOrganizationId,
        status: "active",
        tenantId: session.tenantId,
      },
    });
    if (!organization) throw new BadRequestException("提交组织不存在或已停用");

    let ticket!: Ticket;
    let firstMessage!: Awaited<ReturnType<ConversationCapabilityService["createMessageInTransaction"]>>["message"];
    let conversation!: Awaited<ReturnType<ConversationCapabilityService["ensureConversationForSource"]>>;
    await this.manager.transaction(async (manager) => {
      ticket = await manager.save(
        Ticket,
        manager.create(Ticket, {
          archivedAt: null,
          assigneeUserId: null,
          conversationId: null,
          handlerClosedAt: null,
          lastMessageAt: null,
          participantUserIds: [session.userId],
          requesterClosedAt: null,
          requesterUserId: session.userId,
          sourceOrganizationId: organization.id,
          status: "open",
          subject: input.subject,
          tenantId: session.tenantId,
        }),
      );
      const source = toConversationSource(ticket);
      const created = await this.conversationsService.createMessageInTransaction(manager, {
        authorUserId: session.userId,
        joinedReason: "creator",
        mentionUserIds: [],
        message: { attachments: input.attachments, body: input.body },
        source,
      });
      conversation = created.conversation;
      firstMessage = created.message;
      ticket.conversationId = conversation.id;
      ticket.lastMessageAt = firstMessage.createdAt;
      ticket = await manager.save(Ticket, ticket);
    });
    await this.conversationsService.publishMessageAfterCommit({
      authorUserId: session.userId,
      conversation,
      mentionUserIds: [],
      message: firstMessage,
      resolver: this.conversationResolver,
      source: toConversationSource(ticket),
    });
    return {
      ...toTicketDto(ticket),
      firstMessage: toConversationMessageDto(firstMessage, conversation),
    };
  }

  async getTicket(authorization: string | undefined, ticketId: string) {
    const { ticket } = await this.requireAccessibleTicket(authorization, ticketId);
    return toTicketDto(ticket);
  }

  async listMessages(authorization: string | undefined, ticketId: string) {
    const { session, ticket } = await this.requireAccessibleTicket(authorization, ticketId);
    return this.conversationsService.listMessages({
      resolver: this.conversationResolver,
      source: toConversationSource(ticket),
      userId: session.userId,
    });
  }

  async sendMessage(
    authorization: string | undefined,
    ticketId: string,
    payload: unknown,
  ) {
    const { session, ticket } = await this.requireAccessibleTicket(authorization, ticketId);
    if (ticket.status !== "open") throw new BadRequestException("工单已关闭");
    const input = parseMessagePayload(payload);
    const message = await this.conversationsService.sendMessage({
      authorUserId: session.userId,
      message: input,
      resolver: this.conversationResolver,
      source: toConversationSource(ticket),
    });
    ticket.lastMessageAt = new Date(message.createdAt);
    if (!ticket.participantUserIds.includes(session.userId)) {
      ticket.participantUserIds = [...ticket.participantUserIds, session.userId];
    }
    await this.tickets.save(ticket);
    return message;
  }

  async closeTicket(authorization: string | undefined, ticketId: string) {
    const { session, ticket } = await this.requireAccessibleTicket(authorization, ticketId);
    if (ticket.status !== "open") return toTicketDto(ticket);
    const now = new Date();
    if (ticket.requesterUserId === session.userId) ticket.requesterClosedAt = now;
    else ticket.handlerClosedAt = now;
    ticket.status = "closed";
    const saved = await this.tickets.save(ticket);
    await this.conversationsService.publishSourceUpdated(toConversationSource(saved), {
      status: saved.status,
    });
    return toTicketDto(saved);
  }

  async markTicketRead(authorization: string | undefined, ticketId: string) {
    const { session, ticket } = await this.requireAccessibleTicket(authorization, ticketId);
    return this.conversationsService.markRead({
      resolver: this.conversationResolver,
      source: toConversationSource(ticket),
      userId: session.userId,
    });
  }

  async handlingCapability(authorization: string | undefined, organizationId?: string) {
    const session = await this.requireTenantSession(authorization);
    if (!organizationId) return { canHandle: false };
    const membership = await this.memberships.findOne({
      where: { organizationId, status: "active", tenantId: session.tenantId, userId: session.userId },
    });
    return {
      canHandle: Boolean(
        membership &&
          (await this.hasOrganizationPermission(membership, TICKET_HANDLE_PERMISSION)),
      ),
    };
  }

  async archiveExpiredTickets(tenantId: string) {
    if (tenantId !== this.tenantId) throw new NotFoundException("工作空间不存在");
    const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const tickets = await this.tickets.find({
      where: { status: "closed", tenantId, updatedAt: LessThan(threshold) },
    });
    if (tickets.length === 0) return { archived: 0 };
    const now = new Date();
    for (const ticket of tickets) {
      ticket.archivedAt = now;
      ticket.status = "archived";
    }
    await this.tickets.save(tickets);
    return { archived: tickets.length };
  }

  private async canAccessSource(userId: string, source: ConversationSource) {
    if (source.sourceType !== TICKET_SOURCE_TYPE) return false;
    const ticket = await this.tickets.findOne({
      where: { id: source.sourceId, tenantId: source.tenantId },
    });
    return ticket ? this.canAccessTicket(userId, ticket) : false;
  }

  private async requireAccessibleTicket(
    authorization: string | undefined,
    ticketId: string,
  ) {
    const session = await this.requireTenantSession(authorization);
    const ticket = await this.tickets.findOne({
      relations: { assigneeUser: true, requesterUser: true, sourceOrganization: true },
      where: { id: ticketId, tenantId: session.tenantId },
    });
    if (!ticket) throw new NotFoundException("工单不存在");
    if (!(await this.canAccessTicket(session.userId, ticket))) {
      throw new ForbiddenException("没有访问该工单的权限");
    }
    return { session, ticket };
  }

  private async canAccessTicket(userId: string, ticket: Ticket) {
    if (
      ticket.requesterUserId === userId ||
      ticket.assigneeUserId === userId ||
      ticket.participantUserIds.includes(userId) ||
      (await this.conversationsService.isParticipant(toConversationSource(ticket), userId))
    ) {
      return true;
    }
    const membership = await this.memberships.findOne({
      where: {
        organizationId: ticket.sourceOrganizationId,
        status: "active",
        tenantId: ticket.tenantId,
        userId,
      },
    });
    return Boolean(
      membership &&
        (await this.hasOrganizationPermission(membership, TICKET_HANDLE_PERMISSION)),
    );
  }

  private async requireActiveMembership(
    tenantId: string,
    userId: string,
    organizationId: string,
  ) {
    const membership = await this.memberships.findOne({
      where: { organizationId, status: "active", tenantId, userId },
    });
    if (!membership) {
      throw new ForbiddenException("必须选择已加入的有效组织提交工单");
    }
    return membership;
  }

  private async requireOrganizationPermission(
    membership: UserOrganization,
    permission: string,
  ) {
    if (!(await this.hasOrganizationPermission(membership, permission))) {
      throw new ForbiddenException("没有执行该操作的权限");
    }
  }

  private async hasOrganizationPermission(
    membership: UserOrganization,
    permission: string,
  ) {
    const roleAssignment = await this.organizationRoles.findOne({
      where: {
        membershipId: membership.id,
        organizationId: membership.organizationId,
        tenantId: this.tenantId,
      },
    });
    if (!roleAssignment) return false;
    return Boolean(
      await this.rolePermissions.findOne({
        where: {
          enabled: true,
          permission,
          roleId: roleAssignment.roleId,
          tenantId: this.tenantId,
        },
      }),
    );
  }

  private async requireTenantSession(authorization: string | undefined) {
    let session: Awaited<ReturnType<AuthSessionService["validateAccessToken"]>>;
    try {
      session = await this.authSessionService.validateAccessToken(
        authorization?.replace(/^Bearer\s+/i, "").trim(),
      );
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    if (
      session.principalType !== "tenant" ||
      !session.tenantId ||
      session.tenantId !== this.tenantId
    ) {
      throw new UnauthorizedException("登录会话工作空间上下文无效");
    }
    return { tenantId: session.tenantId, userId: session.userId };
  }

  private get tenantId() {
    return this.tenantContext.current()!.tenantId;
  }

  private get manager() {
    return this.tenantContext.current()!.manager;
  }

  private get tickets() {
    return this.tenantContext.repository(Ticket);
  }

  private get memberships() {
    return this.tenantContext.repository(UserOrganization);
  }

  private get organizations() {
    return this.tenantContext.repository(Organization);
  }

  private get organizationRoles() {
    return this.tenantContext.repository(UserOrganizationRole);
  }

  private get rolePermissions() {
    return this.tenantContext.repository(RolePermission);
  }
}

function toConversationSource(ticket: Ticket): ConversationSource {
  return {
    sourceId: ticket.id,
    sourceType: TICKET_SOURCE_TYPE,
    status: ticket.status,
    subject: ticket.subject,
    tenantId: ticket.tenantId,
  };
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
    participantUserIds: ticket.participantUserIds,
    requesterClosedAt: ticket.requesterClosedAt,
    requesterUserId: ticket.requesterUserId,
    sourceOrganization: ticket.sourceOrganization
      ? {
          id: ticket.sourceOrganization.id,
          name: ticket.sourceOrganization.name,
          slug: ticket.sourceOrganization.slug,
        }
      : undefined,
    sourceOrganizationId: ticket.sourceOrganizationId,
    status: ticket.status,
    subject: ticket.subject,
    tenantId: ticket.tenantId,
    updatedAt: ticket.updatedAt,
  };
}

function parseCreateTicketPayload(payload: unknown) {
  const value = requireRecord(payload);
  return {
    attachments: parseAttachments(value.attachments),
    body: requireText(value.body, "工单内容"),
    sourceOrganizationId: requireText(value.sourceOrganizationId, "提交组织"),
    subject: requireText(value.subject, "工单主题"),
  };
}

function parseMessagePayload(payload: unknown) {
  const value = requireRecord(payload);
  return {
    attachments: parseAttachments(value.attachments),
    body: requireText(value.body, "消息内容"),
  };
}

function parseAttachments(value: unknown): ConversationMessageAttachment[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > MAX_TICKET_ATTACHMENTS) {
    throw new BadRequestException(`附件最多 ${MAX_TICKET_ATTACHMENTS} 个`);
  }
  return value.map((item) => {
    const attachment = requireRecord(item);
    const size = attachment.size === undefined ? undefined : Number(attachment.size);
    if (size !== undefined && (!Number.isFinite(size) || size > MAX_TICKET_ATTACHMENT_SIZE)) {
      throw new BadRequestException("单个附件不能超过 2MB");
    }
    return {
      mimeType: optionalText(attachment.mimeType),
      name: requireText(attachment.name, "附件名称"),
      size,
      type: "image" as const,
      url: requireText(attachment.url, "附件地址"),
    };
  });
}

function parseOptionalTicketStatus(value: unknown): TicketStatus | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (value === "open" || value === "closed" || value === "archived") return value;
  throw new BadRequestException("工单状态无效");
}

function requireRecord(value: unknown): Record<string, unknown> {
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

function optionalText(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
