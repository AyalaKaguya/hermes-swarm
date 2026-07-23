import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectDataSource, InjectRepository } from "@nestjs/typeorm";
import {
  PlatformMembership,
  RolePermission,
  Ticket,
  Workspace,
  WorkspaceMembership,
  type ConversationMessageAttachment,
  type TicketStatus,
} from "@hermes-swarm/core";
import { DataSource, In, IsNull, LessThan, type Repository } from "typeorm";
import { WorkspaceContextService } from "../../../common/database/workspace-context.service.js";
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
const TICKET_SUBMIT_PERMISSION = "ticket.conversation.submit:workspace";
const PLATFORM_TICKET_PERMISSIONS = {
  close: "ticket.conversation.close:platform",
  list: "ticket.conversation.list:platform",
  listMessages: "ticket.conversation.list_messages:platform",
  markRead: "ticket.conversation.mark_read:platform",
  sendMessage: "ticket.conversation.send_message:platform",
  view: "ticket.conversation.view:platform",
} as const;
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
    private readonly workspaceContext: WorkspaceContextService,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    @InjectRepository(Ticket)
    private readonly tickets: Repository<Ticket>,
    @InjectRepository(RolePermission)
    private readonly rolePermissions: Repository<RolePermission>,
    @InjectRepository(WorkspaceMembership)
    private readonly workspaceMemberships: Repository<WorkspaceMembership>,
    @InjectRepository(PlatformMembership)
    private readonly platformMemberships: Repository<PlatformMembership>,
    @InjectRepository(Workspace)
    private readonly platformWorkspaces: Repository<Workspace>,
  ) {}

  async listTickets(
    authorization: string | undefined,
    options: { status?: string } = {},
  ) {
    const session = await this.requireWorkspaceSession(authorization);
    const status = parseOptionalTicketStatus(options.status);
    const tickets = await this.tickets.find({
      order: { updatedAt: "DESC" },
      relations: { assigneeUser: true, requesterUser: true },
      where: {
        ...(status ? { status } : {}),
        workspaceId: session.workspaceId,
      },
    });
    const visible: Ticket[] = [];
    for (const ticket of tickets) {
      if (await this.canAccessTicket(session.userId, ticket)) visible.push(ticket);
    }
    return visible.map(toTicketDto);
  }

  async listPlatformTickets(
    accountId: string,
    options: { status?: string } = {},
  ) {
    await this.assertPlatformPermission(accountId, PLATFORM_TICKET_PERMISSIONS.list);
    const status = parseOptionalTicketStatus(options.status);
    const tickets = await this.tickets.find({
      order: { updatedAt: "DESC" },
      relations: { assigneeUser: true, requesterUser: true },
      where: status ? { status } : {},
    });
    return this.toPlatformTicketDtos(tickets);
  }

  async getPlatformTicket(accountId: string, ticketId: string) {
    await this.assertPlatformPermission(accountId, PLATFORM_TICKET_PERMISSIONS.view);
    const ticket = await this.requirePlatformTicket(ticketId);
    return this.toPlatformTicketDto(ticket);
  }

  async listPlatformMessages(accountId: string, ticketId: string) {
    await this.assertPlatformPermission(
      accountId,
      PLATFORM_TICKET_PERMISSIONS.listMessages,
    );
    const ticket = await this.requirePlatformTicket(ticketId);
    const resolver = this.platformConversationResolver(accountId);
    return this.withTicketWorkspace(ticket, () =>
      this.conversationsService.listMessages({
        resolver,
        source: toConversationSource(ticket),
        userId: accountId,
      }),
    );
  }

  async sendPlatformMessage(
    accountId: string,
    ticketId: string,
    payload: unknown,
  ) {
    await this.assertPlatformPermission(
      accountId,
      PLATFORM_TICKET_PERMISSIONS.sendMessage,
    );
    const ticket = await this.requirePlatformTicket(ticketId);
    if (ticket.status !== "open") throw new BadRequestException("工单已关闭");
    const input = parseMessagePayload(payload);
    const resolver = this.platformConversationResolver(accountId);
    const message = await this.withTicketWorkspace(ticket, () =>
      this.conversationsService.sendMessage({
        authorUserId: accountId,
        message: input,
        resolver,
        source: toConversationSource(ticket),
      }),
    );
    ticket.lastMessageAt = new Date(message.createdAt);
    if (!ticket.participantUserIds.includes(accountId)) {
      ticket.participantUserIds = [...ticket.participantUserIds, accountId];
    }
    const update = await this.tickets.update(
      { id: ticket.id, workspaceId: ticket.workspaceId },
      {
        lastMessageAt: ticket.lastMessageAt,
        participantUserIds: ticket.participantUserIds,
      },
    );
    if (update.affected !== 1) throw new NotFoundException("工单不存在");
    return message;
  }

  async closePlatformTicket(accountId: string, ticketId: string) {
    await this.assertPlatformPermission(accountId, PLATFORM_TICKET_PERMISSIONS.close);
    const ticket = await this.requirePlatformTicket(ticketId);
    if (ticket.status !== "open") return this.toPlatformTicketDto(ticket);
    ticket.handlerClosedAt = new Date();
    ticket.status = "closed";
    const update = await this.tickets.update(
      { id: ticket.id, workspaceId: ticket.workspaceId },
      {
        handlerClosedAt: ticket.handlerClosedAt,
        status: ticket.status,
      },
    );
    if (update.affected !== 1) throw new NotFoundException("工单不存在");
    const saved = await this.requirePlatformTicket(ticket.id);
    await this.withTicketWorkspace(saved, () =>
      this.conversationsService.publishSourceUpdated(toConversationSource(saved), {
        status: saved.status,
      }),
    );
    return this.toPlatformTicketDto(saved);
  }

  async markPlatformTicketRead(accountId: string, ticketId: string) {
    await this.assertPlatformPermission(
      accountId,
      PLATFORM_TICKET_PERMISSIONS.markRead,
    );
    const ticket = await this.requirePlatformTicket(ticketId);
    const resolver = this.platformConversationResolver(accountId);
    return this.withTicketWorkspace(ticket, () =>
      this.conversationsService.markRead({
        resolver,
        source: toConversationSource(ticket),
        userId: accountId,
      }),
    );
  }

  async createTicket(authorization: string | undefined, payload: unknown) {
    const session = await this.requireWorkspaceSession(authorization);
    const input = parseCreateTicketPayload(payload);
    if (!(await this.hasWorkspacePermission(session.userId, TICKET_SUBMIT_PERMISSION))) {
      throw new ForbiddenException("没有提交工单的权限");
    }

    let ticket!: Ticket;
    let firstMessage!: Awaited<ReturnType<ConversationCapabilityService["createMessageInTransaction"]>>["message"];
    let conversation!: Awaited<ReturnType<ConversationCapabilityService["ensureConversationForSource"]>>;
    await this.dataSource.transaction(async (manager) => {
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
          status: "open",
          subject: input.subject,
          workspaceId: session.workspaceId,
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
      await manager.update(
        Ticket,
        { id: ticket.id, workspaceId: session.workspaceId },
        {
          conversationId: ticket.conversationId,
          lastMessageAt: ticket.lastMessageAt,
        },
      );
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
    const update = await this.tickets.update(
      { id: ticket.id, workspaceId: session.workspaceId },
      {
        lastMessageAt: ticket.lastMessageAt,
        participantUserIds: ticket.participantUserIds,
      },
    );
    if (update.affected !== 1) throw new NotFoundException("工单不存在");
    return message;
  }

  async closeTicket(authorization: string | undefined, ticketId: string) {
    const { session, ticket } = await this.requireAccessibleTicket(authorization, ticketId);
    if (ticket.status !== "open") return toTicketDto(ticket);
    if (ticket.requesterUserId !== session.userId) {
      throw new ForbiddenException("工单由平台支持团队处理");
    }
    const now = new Date();
    ticket.requesterClosedAt = now;
    ticket.status = "closed";
    const update = await this.tickets.update(
      { id: ticket.id, workspaceId: session.workspaceId },
      {
        handlerClosedAt: ticket.handlerClosedAt,
        requesterClosedAt: ticket.requesterClosedAt,
        status: ticket.status,
      },
    );
    if (update.affected !== 1) throw new NotFoundException("工单不存在");
    const saved = await this.tickets.findOne({
      relations: { assigneeUser: true, requesterUser: true },
      where: { id: ticket.id, workspaceId: session.workspaceId },
    });
    if (!saved) throw new NotFoundException("工单不存在");
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

  async handlingCapability(authorization: string | undefined) {
    await this.requireWorkspaceSession(authorization);
    return { canHandle: false };
  }

  async archiveExpiredTickets(workspaceId: string) {
    if (workspaceId !== this.workspaceId) throw new NotFoundException("工作空间不存在");
    const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const tickets = await this.tickets.find({
      where: { status: "closed", workspaceId, updatedAt: LessThan(threshold) },
    });
    if (tickets.length === 0) return { archived: 0 };
    const now = new Date();
    const result = await this.tickets.update(
      { id: In(tickets.map((ticket) => ticket.id)), workspaceId },
      { archivedAt: now, status: "archived" },
    );
    return { archived: result.affected ?? 0 };
  }

  private async canAccessSource(userId: string, source: ConversationSource) {
    if (
      source.sourceType !== TICKET_SOURCE_TYPE ||
      source.workspaceId !== this.workspaceId
    ) {
      return false;
    }
    const ticket = await this.tickets.findOne({
      where: { id: source.sourceId, workspaceId: source.workspaceId },
    });
    return ticket ? this.canAccessTicket(userId, ticket) : false;
  }

  private async requireAccessibleTicket(
    authorization: string | undefined,
    ticketId: string,
  ) {
    const session = await this.requireWorkspaceSession(authorization);
    const ticket = await this.tickets.findOne({
      relations: { assigneeUser: true, requesterUser: true },
      where: { id: ticketId, workspaceId: session.workspaceId },
    });
    if (!ticket) throw new NotFoundException("工单不存在");
    if (!(await this.canAccessTicket(session.userId, ticket))) {
      throw new ForbiddenException("没有访问该工单的权限");
    }
    return { session, ticket };
  }

  private async canAccessTicket(userId: string, ticket: Ticket) {
    if (
      ticket.workspaceId !== this.workspaceId ||
      !(await this.hasActiveWorkspaceMembership(userId, ticket.workspaceId))
    ) {
      return false;
    }
    if (
      ticket.requesterUserId === userId ||
      ticket.participantUserIds.includes(userId) ||
      (await this.conversationsService.isParticipant(toConversationSource(ticket), userId))
    ) {
      return true;
    }
    return false;
  }

  private platformConversationResolver(
    accountId: string,
  ): ConversationAccessResolver {
    return {
      buildNotificationPayload: this.conversationResolver.buildNotificationPayload,
      canJoin: async (userId, source) =>
        userId === accountId && await this.canPlatformJoinSource(accountId, source),
      canRead: async (userId, source) =>
        userId === accountId && await this.canAccessPlatformSource(accountId, source),
      canWrite: async (userId, source) =>
        userId === accountId && await this.canAccessPlatformSource(accountId, source),
    };
  }

  private async canAccessPlatformSource(
    accountId: string,
    source: ConversationSource,
  ) {
    if (
      !accountId ||
      source.sourceType !== TICKET_SOURCE_TYPE ||
      source.workspaceId !== this.workspaceId
    ) {
      return false;
    }
    return Boolean(
      await this.tickets.findOne({
        where: { id: source.sourceId, workspaceId: source.workspaceId },
      }),
    );
  }

  private async canPlatformJoinSource(
    accountId: string,
    source: ConversationSource,
  ) {
    if (!(await this.canAccessPlatformSource(accountId, source))) return false;
    const membership = await this.platformMemberships.findOne({
      relations: { role: true },
      where: { accountId, status: "active" },
    });
    return Boolean(
      membership?.roleId &&
        membership.role?.scope === "platform" &&
        membership.role.workspaceId === null,
    );
  }

  private async assertPlatformPermission(accountId: string, permission: string) {
    const membership = await this.platformMemberships.findOne({
      relations: { role: true },
      where: { accountId, status: "active" },
    });
    if (
      !membership?.roleId ||
      membership.role?.scope !== "platform" ||
      membership.role.workspaceId !== null
    ) {
      throw new ForbiddenException("没有处理平台工单的权限");
    }
    const granted = await this.rolePermissions.findOne({
      relations: { permissionRecord: true, role: true },
      where: {
        enabled: true,
        permissionRecord: { code: permission },
        role: { scope: "platform", workspaceId: IsNull() },
        roleId: membership.roleId,
      },
    });
    if (!granted) throw new ForbiddenException("没有处理平台工单的权限");
  }

  private async requirePlatformTicket(ticketId: string) {
    const ticket = await this.tickets.findOne({
      relations: { assigneeUser: true, requesterUser: true },
      where: { id: ticketId },
    });
    if (!ticket) throw new NotFoundException("工单不存在");
    return ticket;
  }

  private withTicketWorkspace<T>(ticket: Ticket, work: () => Promise<T>) {
    return this.workspaceContext.run(
      { scopeLevel: "workspace", workspaceId: ticket.workspaceId },
      work,
    );
  }

  private async toPlatformTicketDto(ticket: Ticket) {
    const workspace = await this.platformWorkspaces.findOne({
      where: { id: ticket.workspaceId },
    });
    if (!workspace) throw new NotFoundException("工单所属工作空间不存在");
    return toPlatformTicketDto(ticket, workspace);
  }

  private async toPlatformTicketDtos(tickets: Ticket[]) {
    if (tickets.length === 0) return [];
    const workspaces = await this.platformWorkspaces.find({
      where: { id: In([...new Set(tickets.map((ticket) => ticket.workspaceId))]) },
    });
    const workspacesById = new Map(workspaces.map((workspace) => [workspace.id, workspace]));
    return tickets.map((ticket) => {
      const workspace = workspacesById.get(ticket.workspaceId);
      if (!workspace) throw new NotFoundException("工单所属工作空间不存在");
      return toPlatformTicketDto(ticket, workspace);
    });
  }

  private async hasWorkspacePermission(userId: string, permission: string) {
    const workspaceId = this.workspaceId;
    const roleAssignment = await this.workspaceMemberships.findOne({
      relations: { role: true },
      where: {
        accountId: userId,
        status: "active",
        workspaceId,
      },
    });
    if (
      !roleAssignment?.roleId ||
      roleAssignment.role?.scope !== "workspace" ||
      roleAssignment.role.workspaceId !== workspaceId
    ) {
      return false;
    }
    return Boolean(
      await this.rolePermissions.findOne({
        relations: { permissionRecord: true, role: true },
        where: {
          enabled: true,
          permissionRecord: { code: permission },
          roleId: roleAssignment.roleId,
          role: { scope: "workspace", workspaceId },
        },
      }),
    );
  }

  private async hasActiveWorkspaceMembership(userId: string, workspaceId: string) {
    return Boolean(
      await this.workspaceMemberships.findOne({
        where: { accountId: userId, status: "active", workspaceId },
      }),
    );
  }

  private async requireWorkspaceSession(authorization: string | undefined) {
    let session: Awaited<ReturnType<AuthSessionService["validateAccessToken"]>>;
    try {
      session = await this.authSessionService.validateAccessToken(
        authorization?.replace(/^Bearer\s+/i, "").trim(),
      );
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }
    if (
      session.principalType !== "workspace" ||
      !session.workspaceId ||
      session.workspaceId !== this.workspaceId
    ) {
      throw new UnauthorizedException("登录会话工作空间上下文无效");
    }
    return { workspaceId: session.workspaceId, userId: session.userId };
  }

  private get workspaceId() {
    return this.workspaceContext.current()!.workspaceId;
  }
}

function toConversationSource(ticket: Ticket): ConversationSource {
  return {
    sourceId: ticket.id,
    sourceType: TICKET_SOURCE_TYPE,
    status: ticket.status,
    subject: ticket.subject,
    workspaceId: ticket.workspaceId,
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
    status: ticket.status,
    subject: ticket.subject,
    updatedAt: ticket.updatedAt,
  };
}

function toPlatformTicketDto(ticket: Ticket, workspace: Workspace) {
  return {
    ...toTicketDto(ticket),
    workspace: {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
    },
  };
}

function parseCreateTicketPayload(payload: unknown) {
  const value = requireRecord(payload);
  return {
    attachments: parseAttachments(value.attachments),
    body: requireText(value.body, "工单内容"),
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
