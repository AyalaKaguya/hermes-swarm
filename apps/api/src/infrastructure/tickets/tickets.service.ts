import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  FEATURE_SETTING_KEYS,
  PLATFORM_SETTING_KEYS,
  RolePermission,
  Ticket,
  TicketMessage,
  type ConversationMessageAttachment,
  type TicketStatus,
  UserOrganization,
  UserTenantRole,
} from "@hermes-swarm/core";
import { In, Repository, type EntityManager } from "typeorm";
import { AuthSessionService } from "../auth/auth-session.service.js";
import {
  ConversationCapabilityService,
  toConversationMessageDto,
} from "../conversations/conversations.service.js";
import type { ConversationSource } from "../conversations/conversation-access-resolver.js";
import { SettingsService } from "../settings/settings.service.js";
import { TicketConversationAccessResolver } from "./ticket-conversation-access.resolver.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import {
  DepartmentDispatchResolverService,
  type DepartmentDispatchResolution,
} from "../departments/department-dispatch-resolver.service.js";

const TICKET_SOURCE_TYPE = "ticket";
const ARCHIVE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
const ORGANIZATION_TICKETING_FEATURE_KEY = FEATURE_SETTING_KEYS.ticketing;
const ORGANIZATION_TICKET_HANDLING_FEATURE_KEY =
  FEATURE_SETTING_KEYS.ticketingHandling;
const ORGANIZATION_TICKET_HANDLE_PERMISSION =
  "ticket.conversation.handle:organization";
const TENANT_TICKET_HANDLE_PERMISSION =
  "ticket.tenant_conversation.handle:tenant";
const MAX_TICKET_ATTACHMENTS = 6;
const MAX_TICKET_ATTACHMENT_SIZE = 2 * 1024 * 1024;

@Injectable()
export class TicketsService {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(TicketMessage)
    private readonly legacyMessageRepository: Repository<TicketMessage>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(UserTenantRole)
    private readonly userTenantRoleRepository: Repository<UserTenantRole>,
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
    @Optional()
    @Inject(TenantContextService)
    private readonly tenantContext?: TenantContextService,
    @Optional()
    @Inject(DepartmentDispatchResolverService)
    private readonly departmentDispatchResolver?: DepartmentDispatchResolverService,
  ) {}

  async listOrganizationTickets(
    authorization: string | undefined,
    organizationId: string,
    status?: string,
  ) {
    await this.requireTicketingVisible();
    const normalizedStatus = parseOptionalTicketStatus(status);
    const session = await this.requireSession(authorization);
    const tenantId = this.requireTenantId(session.tenantId);
    await this.archiveExpiredTickets(tenantId);
    await this.requireOrganizationMember(tenantId, session.userId, organizationId);
    const canHandle = await this.canHandleOrganizationTickets(
      session.userId,
      organizationId,
      tenantId,
    );
    const baseWhere = {
      organizationId,
      tenantId,
      ...(normalizedStatus ? { status: normalizedStatus } : {}),
    };
    const participantTicketIds = canHandle
      ? []
      : await this.conversationsService.listParticipantSourceIds({
          organizationId,
          scope: "organization",
          sourceType: TICKET_SOURCE_TYPE,
          tenantId,
          userId: session.userId,
        });
    const tickets = await this.ticketRepositoryForContext().find({
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
    const tenantId = this.requireTenantId(session.tenantId);
    await this.requireOrganizationMember(tenantId, session.userId, organizationId);
    await this.requireOrganizationTicketingEnabled(
      tenantId,
      session.userId,
      organizationId,
    );
    const input = parseTicketPayload(payload);
    let dispatch: DepartmentDispatchResolution | null = null;
    if (input.departmentId) {
      if (!this.departmentDispatchResolver) {
        throw new BadRequestException("部门调度服务不可用");
      }
      dispatch = await this.departmentDispatchResolver.resolveTicketAssignment({
        idempotencyKey: requireText(input.idempotencyKey, "调度幂等键"),
        sourceDepartmentId: input.departmentId,
        tenantId,
      });
    }
    const routedTarget = dispatch?.targets[0];
    return this.createTicketWithFirstMessage({
      attachments: input.attachments,
      body: input.body,
      departmentId: routedTarget?.departmentId ?? input.departmentId,
      dispatch,
      organizationId: routedTarget?.organizationId ?? organizationId,
      tenantId,
      requesterUserId: session.userId,
      scope: input.departmentId ? "department" : "organization",
      subject: input.subject,
    });
  }

  /** Resolves the route only; it never grants ticket or department access. */
  async resolveTicketEscalationRoute(
    tenantId: string,
    ticketId: string,
    idempotencyKey: string,
    maxHops?: number,
  ) {
    const ticket = await this.findTicketOrThrow(this.requireTenantId(tenantId), ticketId);
    if (!ticket.departmentId) {
      throw new BadRequestException("工单没有部门作用域，无法升级");
    }
    if (!this.departmentDispatchResolver) {
      throw new BadRequestException("部门调度服务不可用");
    }
    return this.departmentDispatchResolver.resolveEscalationRoute({
      idempotencyKey,
      maxHops,
      sourceDepartmentId: ticket.departmentId,
      tenantId,
    });
  }

  async listTenantTickets(authorization: string | undefined, status?: string) {
    await this.requireTicketingVisible();
    const normalizedStatus = parseOptionalTicketStatus(status);
    const session = await this.requireSession(authorization);
    const tenantId = this.requireTenantId(session.tenantId);
    await this.archiveExpiredTickets(tenantId);
    const canHandle = await this.canHandleTenantTickets(tenantId, session.userId);
    const participantTicketIds = canHandle
      ? []
      : await this.conversationsService.listParticipantSourceIds({
          scope: "tenant",
          sourceType: TICKET_SOURCE_TYPE,
          tenantId,
          userId: session.userId,
        });
    const tickets = await this.ticketRepositoryForContext().find({
      order: { updatedAt: "DESC" },
      where: canHandle
        ? {
            scope: "tenant",
            tenantId,
            ...(normalizedStatus ? { status: normalizedStatus } : {}),
          }
        : [
            {
              requesterUserId: session.userId,
              scope: "tenant",
              tenantId,
              ...(normalizedStatus ? { status: normalizedStatus } : {}),
            },
            ...(participantTicketIds.length > 0
              ? [
                  {
                    id: In(participantTicketIds),
                    scope: "tenant" as const,
                    tenantId,
                    ...(normalizedStatus ? { status: normalizedStatus } : {}),
                  },
                ]
              : []),
          ],
    });
    return tickets.map(toTicketDto);
  }

  async createTenantTicket(authorization: string | undefined, payload: unknown) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const tenantId = this.requireTenantId(session.tenantId);
    await this.ensureCanSubmitTenantTicket(tenantId, session.userId);
    const input = parseTicketPayload(payload);
    return this.createTicketWithFirstMessage({
      attachments: input.attachments,
      body: input.body,
      organizationId: null,
      requesterUserId: session.userId,
      scope: "tenant",
      subject: input.subject,
      tenantId,
    });
  }

  async getTicket(authorization: string | undefined, ticketId: string) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const tenantId = this.requireTenantId(session.tenantId);
    const ticket = await this.findTicketOrThrow(tenantId, ticketId);
    await this.requireTicketAccess(session.userId, ticket);
    return toTicketDto(ticket);
  }

  async listMessages(authorization: string | undefined, ticketId: string) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const tenantId = this.requireTenantId(session.tenantId);
    const ticket = await this.findTicketOrThrow(tenantId, ticketId);
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
    const tenantId = this.requireTenantId(session.tenantId);
    const ticket = await this.findTicketOrThrow(tenantId, ticketId);
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
    const updatedTicket = await this.withManager(async (manager) => {
        const lockedTicket = await this.findTicketForUpdateOrThrow(manager, tenantId, ticketId);
        await this.requireTicketAccess(session.userId, lockedTicket);
        if (lockedTicket.status === "archived") {
          throw new BadRequestException("工单已归档");
        }
        lockedTicket.status = "open";
        lockedTicket.archivedAt = null;
        lockedTicket.lastMessageAt = new Date(String(message.createdAt));
        if (lockedTicket.requesterUserId === session.userId) {
          lockedTicket.requesterClosedAt = null;
        } else {
          lockedTicket.handlerClosedAt = null;
        }
        return manager.save(Ticket, lockedTicket);
      });
    await this.conversationsService.publishSourceUpdated(
      this.toConversationSource(updatedTicket),
      toTicketDto(updatedTicket),
    );
    return toTicketMessageDto(message);
  }

  async closeTicket(authorization: string | undefined, ticketId: string) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const tenantId = this.requireTenantId(session.tenantId);
    const ticket = await this.withManager(async (manager) => {
        const lockedTicket = await this.findTicketForUpdateOrThrow(manager, tenantId, ticketId);
        await this.requireTicketAccess(session.userId, lockedTicket);
        if (lockedTicket.status === "archived") {
          throw new BadRequestException("工单已归档");
        }

        const now = new Date();
        if (lockedTicket.requesterUserId === session.userId) {
          lockedTicket.requesterClosedAt = now;
        } else {
          lockedTicket.handlerClosedAt = now;
        }
        if (lockedTicket.requesterClosedAt && lockedTicket.handlerClosedAt) {
          lockedTicket.status = "archived";
          lockedTicket.archivedAt = now;
        } else {
          lockedTicket.status = "closed";
          lockedTicket.archivedAt = null;
        }
        return manager.save(Ticket, lockedTicket);
      });
    await this.conversationsService.publishSourceUpdated(
      this.toConversationSource(ticket),
      toTicketDto(ticket),
    );
    return toTicketDto(ticket);
  }

  async markTicketRead(authorization: string | undefined, ticketId: string) {
    await this.requireTicketingVisible();
    const session = await this.requireSession(authorization);
    const tenantId = this.requireTenantId(session.tenantId);
    const ticket = await this.findTicketOrThrow(tenantId, ticketId);
    await this.requireTicketAccess(session.userId, ticket);
    return this.conversationsService.markRead({
      resolver: this.ticketConversationAccessResolver,
      source: this.toConversationSource(ticket),
      userId: session.userId,
    });
  }

  async archiveExpiredTickets(tenantId: string) {
    this.requireTenantId(tenantId);
    const threshold = new Date(Date.now() - ARCHIVE_AFTER_MS);
    const now = new Date();
    const result = await this.ticketRepositoryForContext()
      .createQueryBuilder()
      .update(Ticket)
      .set({ archivedAt: now, status: "archived" })
      .where("status = :status", { status: "closed" })
      .andWhere("tenant_id = :tenantId", { tenantId })
      .andWhere("archived_at IS NULL")
      .andWhere(
        [
          "(",
          "handler_closed_at <= :threshold AND requester_closed_at IS NULL",
          ") OR (",
          "requester_closed_at <= :threshold AND handler_closed_at IS NULL",
          ")",
        ].join(" "),
        { threshold },
      )
      .execute();
    return { archived: result.affected ?? 0 };
  }

  private async findTicketOrThrow(tenantId: string, ticketId: string) {
    const ticket = await this.ticketRepositoryForContext().findOne({
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException("工单不存在");
    return ticket;
  }

  private async findTicketForUpdateOrThrow(
    manager: EntityManager,
    tenantId: string,
    ticketId: string,
  ) {
    const ticket = await manager.findOne(Ticket, {
      lock: { mode: "pessimistic_write" },
      where: { id: ticketId, tenantId },
    });
    if (!ticket) throw new NotFoundException("工单不存在");
    return ticket;
  }

  private async createTicketWithFirstMessage(input: {
    attachments: ConversationMessageAttachment[] | null;
    body: string;
    departmentId?: string | null;
    dispatch?: DepartmentDispatchResolution | null;
    organizationId: string | null;
    requesterUserId: string;
    scope: "department" | "organization" | "tenant";
    subject: string;
    tenantId: string;
  }) {
    let ticket!: Ticket;
    let mentionUserIds: string[] = [];
    let conversation!: Awaited<ReturnType<ConversationCapabilityService["createMessageInTransaction"]>>["conversation"];
    let message!: Awaited<ReturnType<ConversationCapabilityService["createMessageInTransaction"]>>["message"];
    await this.withManager(async (manager) => {
      ticket = await manager.save(
        Ticket,
        this.ticketRepositoryForContext().create({
          lastMessageAt: null,
          departmentId: input.departmentId ?? null,
          organizationId: input.organizationId,
          participantUserIds: [input.requesterUserId],
          requesterUserId: input.requesterUserId,
          scope: input.scope,
          status: "open",
          subject: input.subject,
          tenantId: input.tenantId,
        }),
      );
      const source = this.toConversationSource(ticket);
      mentionUserIds =
        await this.conversationsService.resolveMentionedUserIdsForSource({
          authorUserId: input.requesterUserId,
          body: input.body,
          resolver: this.ticketConversationAccessResolver,
          source,
        });
      ({ conversation, message } = await this.conversationsService.createMessageInTransaction(
        manager,
        {
          authorUserId: input.requesterUserId,
          joinedReason: "creator",
          mentionUserIds,
          message: { attachments: input.attachments, body: input.body },
          source,
        },
      ));
      ticket.conversationId = conversation.id;
      ticket.lastMessageAt = message.createdAt;
      ticket = await manager.save(Ticket, ticket);
    });
    await this.conversationsService.publishMessageAfterCommit({
      authorUserId: input.requesterUserId,
      conversation,
      mentionUserIds,
      message,
      resolver: this.ticketConversationAccessResolver,
      source: this.toConversationSource(ticket),
    });
    return {
      ...toTicketDto(ticket),
      ...(input.dispatch ? { dispatch: input.dispatch } : {}),
      firstMessage: toTicketMessageDto(toConversationMessageDto(message, conversation)),
    };
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
      await this.ticketRepositoryForContext().save(ticket);
    }
    await this.migrateLegacyMessages(ticket, conversation.id);
    await this.conversationsService.addParticipants({
      conversationId: conversation.id,
      joinedReason,
      tenantId: ticket.tenantId,
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
    const legacyMessages = await this.legacyMessageRepositoryForContext().find({
      order: { createdAt: "ASC" },
      where: { tenantId: ticket.tenantId, ticketId: ticket.id },
    });
    await this.conversationsService.importMessagesIfEmpty({
      conversationId,
      tenantId: ticket.tenantId,
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
      departmentId: ticket.departmentId,
      organizationId: ticket.organizationId,
      scope: ticket.scope,
      sourceId: ticket.id,
      sourceType: TICKET_SOURCE_TYPE,
      status: ticket.status,
      subject: ticket.subject,
      tenantId: ticket.tenantId,
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
    if (ticket.scope === "tenant") {
      if (await this.canHandleTenantTickets(ticket.tenantId, userId)) return;
      throw new ForbiddenException("没有处理租户工单的权限");
      return;
    }
    if (
      ticket.organizationId &&
      (await this.canHandleOrganizationTickets(
        userId,
        ticket.organizationId,
        ticket.tenantId,
      ))
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

  private async requireOrganizationMember(
    tenantId: string,
    userId: string,
    organizationId: string,
  ) {
    const membership = await this.membershipRepositoryForContext().findOne({
      where: { organizationId, status: "active", tenantId, userId },
    });
    if (!membership) throw new ForbiddenException("不是当前组织成员");
    return membership;
  }

  private async requireTicketingVisible() {
    const enabled = await this.getPlatformBooleanSetting(
      PLATFORM_SETTING_KEYS.ticketingVisible,
      true,
    );
    if (!enabled) throw new ForbiddenException("工单功能已关闭");
  }

  private async requireOrganizationTicketingEnabled(
    tenantId: string,
    userId: string,
    organizationId: string,
  ) {
    const value = await this.settingsService.getOrganizationValue(
      organizationId,
      ORGANIZATION_TICKETING_FEATURE_KEY,
      "true",
    );
    if (
      value === "true" ||
      (await this.isOrganizationOwner(tenantId, userId, organizationId))
    ) {
      return;
    }
    throw new ForbiddenException("当前组织未启用工单功能");
  }

  private async ensureCanSubmitTenantTicket(tenantId: string, userId: string) {
    const enabled = await this.getPlatformBooleanSetting(
      PLATFORM_SETTING_KEYS.ticketingPlatformSubmissionEnabled,
      true,
    );
    if (
      enabled ||
      (await this.canHandleTenantTickets(tenantId, userId)) ||
      (await this.isAnyOrganizationOwner(tenantId, userId))
    ) {
      return;
    }
    throw new ForbiddenException("租户工单提交已关闭");
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

  private async canHandleOrganizationTickets(
    userId: string,
    organizationId: string,
    tenantId: string,
  ) {
    if (!(await this.isOrganizationTicketHandlingEnabled(organizationId))) {
      return false;
    }
    const membership = await this.membershipRepositoryForContext().findOne({
      where: { organizationId, status: "active", tenantId, userId },
    });
    return membership?.roleId
      ? this.roleHasPermission(
          membership.roleId,
          ORGANIZATION_TICKET_HANDLE_PERMISSION,
          tenantId,
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

  private async isOrganizationOwner(
    tenantId: string,
    userId: string,
    organizationId: string,
  ) {
    const membership = await this.membershipRepositoryForContext().findOne({
      relations: { role: true },
      where: { organizationId, status: "active", tenantId, userId },
    });
    return membership?.role?.name === "owner";
  }

  private async isAnyOrganizationOwner(tenantId: string, userId: string) {
    const memberships = await this.membershipRepositoryForContext().find({
      relations: { role: true },
      where: { status: "active", tenantId, userId },
    });
    return memberships.some((membership) => membership.role?.name === "owner");
  }

  private async canHandleTenantTickets(tenantId: string, userId: string) {
    const assignments = await this.userTenantRoleRepositoryForContext().find({
      where: { tenantId, userId },
    });
    if (assignments.length === 0) return false;
    return Boolean(
      await this.rolePermissionRepositoryForContext().findOne({
        where: {
          enabled: true,
          permission: TENANT_TICKET_HANDLE_PERMISSION,
          roleId: In(assignments.map((assignment) => assignment.roleId)),
          tenantId,
        },
      }),
    );
  }

  private async roleHasPermission(
    roleId: string,
    permission: string,
    tenantId: string,
  ) {
    return Boolean(
      await this.rolePermissionRepositoryForContext().findOne({
        where: {
          enabled: true,
          permission,
          roleId,
          tenantId,
        },
      }),
    );
  }

  private requireTenantId(sessionTenantId: string | null | undefined) {
    const tenantId = sessionTenantId?.trim();
    if (!tenantId) throw new UnauthorizedException("登录会话缺少租户上下文");
    const context = this.tenantContext?.current(false);
    if (context && context.tenantId !== tenantId) {
      throw new UnauthorizedException("登录会话与租户数据库上下文不一致");
    }
    return tenantId;
  }

  private managerForContext() {
    return this.tenantContext?.current(false)?.manager ?? this.ticketRepository.manager;
  }

  private withManager<T>(work: (manager: EntityManager) => Promise<T>) {
    const context = this.tenantContext?.current(false);
    if (context) return work(context.manager);
    const manager = this.ticketRepository.manager;
    return typeof manager.transaction === "function"
      ? manager.transaction(work)
      : work(manager);
  }

  private ticketRepositoryForContext() {
    return this.tenantContext?.current(false)
      ? this.tenantContext.repository(Ticket)
      : this.ticketRepository;
  }

  private legacyMessageRepositoryForContext() {
    return this.tenantContext?.current(false)
      ? this.tenantContext.repository(TicketMessage)
      : this.legacyMessageRepository;
  }

  private membershipRepositoryForContext() {
    return this.tenantContext?.current(false)
      ? this.tenantContext.repository(UserOrganization)
      : this.membershipRepository;
  }

  private rolePermissionRepositoryForContext() {
    return this.tenantContext?.current(false)
      ? this.tenantContext.repository(RolePermission)
      : this.rolePermissionRepository;
  }

  private userTenantRoleRepositoryForContext() {
    return this.tenantContext?.current(false)
      ? this.tenantContext.repository(UserTenantRole)
      : this.userTenantRoleRepository;
  }

}

function parseTicketPayload(payload: unknown) {
  const value = assertObject(payload);
  return {
    ...parseMessagePayload(payload),
    departmentId: optionalText(value.departmentId),
    idempotencyKey: optionalText(value.idempotencyKey),
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

function optionalText(value: unknown) {
  if (value === undefined || value === null || value === "") return null;
  return requireText(value, "字段");
}

function parseAttachments(value: unknown): ConversationMessageAttachment[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new BadRequestException("附件格式无效");
  if (value.length > MAX_TICKET_ATTACHMENTS) {
    throw new BadRequestException(`附件不能超过 ${MAX_TICKET_ATTACHMENTS} 个`);
  }
  return value.map((item) => {
    const attachment = assertObject(item);
    const url = requireText(attachment.url, "附件地址");
    const name = requireText(attachment.name, "附件名称");
    const type = attachment.type === "image" ? "image" : null;
    if (!type) throw new BadRequestException("仅支持图片附件");
    const size = parseOptionalAttachmentSize(attachment.size);
    return {
      mimeType:
        typeof attachment.mimeType === "string" ? attachment.mimeType : undefined,
      name,
      size,
      type,
      url,
    };
  });
}

function parseOptionalAttachmentSize(value: unknown) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new BadRequestException("附件大小无效");
  }
  if (value > MAX_TICKET_ATTACHMENT_SIZE) {
    throw new BadRequestException("附件大小超过限制");
  }
  return value;
}

function parseOptionalTicketStatus(value: string | undefined): TicketStatus | undefined {
  if (value === undefined || value === "") return undefined;
  if (value === "open" || value === "closed" || value === "archived") return value;
  throw new BadRequestException("工单状态无效");
}

function toTicketDto(ticket: Ticket) {
  return {
    archivedAt: ticket.archivedAt,
    assigneeUserId: ticket.assigneeUserId,
    conversationId: ticket.conversationId,
    createdAt: ticket.createdAt,
    departmentId: ticket.departmentId,
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
    tenantId: ticket.tenantId,
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
