import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Conversation,
  ConversationMessage,
  ConversationParticipant,
  Account,
  type ConversationMessageAttachment,
  type ConversationParticipantJoinedReason,
} from "@hermes-swarm/core";
import {
  In,
  Repository,
  type EntityManager,
} from "typeorm";
import { NotificationsService } from "../../../infrastructure/notifications/notifications.service.js";
import { RealtimeEventBus } from "../../../infrastructure/realtime/realtime-event-bus.service.js";
import type {
  ConversationAccessResolver,
  ConversationMessageInput,
  ConversationNotificationPayload,
  ConversationSource,
} from "./conversation-access-resolver.js";
import { WorkspaceContextService } from "../../../common/database/workspace-context.service.js";

@Injectable()
export class ConversationCapabilityService {
  private readonly logger = new Logger(ConversationCapabilityService.name);

  constructor(
    @InjectRepository(Conversation)
    private readonly conversationRepository: Repository<Conversation>,
    @InjectRepository(ConversationMessage)
    private readonly messageRepository: Repository<ConversationMessage>,
    @InjectRepository(ConversationParticipant)
    private readonly participantRepository: Repository<ConversationParticipant>,
    @InjectRepository(Account)
    private readonly userRepository: Repository<Account>,
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService,
    @Inject(RealtimeEventBus)
    private readonly realtimeEventBus: RealtimeEventBus,
    @Optional()
    @Inject(WorkspaceContextService)
    private readonly workspaceContext?: WorkspaceContextService,
  ) {}

  async ensureConversationForSource(source: ConversationSource) {
    return this.withManager((manager) =>
      this.ensureConversationForSourceWithManager(source, manager),
    );
  }

  private async ensureConversationForSourceWithManager(
    source: ConversationSource,
    manager: EntityManager,
  ) {
    this.requireSourceWorkspace(source);
    const existing = await manager.findOne(Conversation, {
      where: {
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        workspaceId: source.workspaceId,
      },
    });
    if (existing) return this.syncConversation(existing, source, manager);

    try {
      return await manager.save(
        Conversation,
        this.conversationRepositoryForContext().create({
          lastMessageAt: null,
          sourceId: source.sourceId,
          sourceType: source.sourceType,
          status: source.status ?? "open",
          subject: source.subject,
          workspaceId: source.workspaceId,
        }),
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await manager.findOne(Conversation, {
        where: {
          sourceId: source.sourceId,
          sourceType: source.sourceType,
          workspaceId: source.workspaceId,
        },
      });
      if (!concurrent) throw error;
      return this.syncConversation(concurrent, source, manager);
    }
  }

  async listMessages(input: {
    resolver: ConversationAccessResolver;
    source: ConversationSource;
    userId: string;
  }) {
    this.requireSourceWorkspace(input.source);
    this.requireSourceWorkspace(input.source);
    if (!(await input.resolver.canRead(input.userId, input.source))) {
      throw new ForbiddenException("没有访问该会话的权限");
    }
    const conversation = await this.ensureConversationForSource(input.source);
    const messages = await this.messageRepositoryForContext().find({
      order: { createdAt: "ASC" },
      relations: { authorUser: true },
      where: { conversationId: conversation.id, workspaceId: input.source.workspaceId },
    });
    return messages.map((message) => toConversationMessageDto(message, conversation));
  }

  async sendMessage(input: {
    authorUserId: string;
    message: ConversationMessageInput;
    resolver: ConversationAccessResolver;
    source: ConversationSource;
  }) {
    this.requireSourceWorkspace(input.source);
    if (!(await input.resolver.canWrite(input.authorUserId, input.source))) {
      throw new ForbiddenException("没有发送会话消息的权限");
    }
    const mentionUserIds = await this.resolveMentionedUserIdsForSource({
      authorUserId: input.authorUserId,
      body: input.message.body,
      resolver: input.resolver,
      source: input.source,
    });
    let conversation!: Conversation;
    let message!: ConversationMessage;
    await this.withManager(async (manager) => {
      ({ conversation, message } = await this.createMessageInTransaction(manager, {
        authorUserId: input.authorUserId,
        joinedReason: "reply",
        mentionUserIds,
        message: input.message,
        source: input.source,
      }));
    });
    await this.publishMessageAfterCommit({
      authorUserId: input.authorUserId,
      conversation,
      mentionUserIds,
      message,
      resolver: input.resolver,
      source: input.source,
    });
    return toConversationMessageDto(message, conversation);
  }

  async createMessageInTransaction(
    manager: EntityManager,
    input: {
      authorUserId: string;
      joinedReason: ConversationParticipantJoinedReason;
      mentionUserIds?: string[];
      message: ConversationMessageInput;
      source: ConversationSource;
    },
  ) {
    this.requireSourceWorkspace(input.source);
    const conversation = await this.ensureConversationForSourceWithManager(
      input.source,
      manager,
    );
    await this.addParticipantsWithManager(manager, {
      conversationId: conversation.id,
      joinedReason: input.joinedReason,
      workspaceId: input.source.workspaceId,
      userIds: [input.authorUserId],
    });
    await this.addParticipantsWithManager(manager, {
      conversationId: conversation.id,
      joinedReason: "mention",
      workspaceId: input.source.workspaceId,
      userIds: input.mentionUserIds ?? [],
    });
    const message = await manager.save(
      ConversationMessage,
      this.messageRepositoryForContext().create({
        attachments: input.message.attachments ?? null,
        authorUserId: input.authorUserId,
        body: input.message.body,
        conversationId: conversation.id,
        kind: "message",
        metadata: input.message.metadata ?? null,
        workspaceId: input.source.workspaceId,
      }),
    );
    conversation.lastMessageAt = message.createdAt;
    conversation.status = input.source.status ?? conversation.status;
    return { conversation: await manager.save(Conversation, conversation), message };
  }

  async resolveMentionedUserIdsForSource(input: {
    authorUserId: string;
    body: string;
    resolver: ConversationAccessResolver;
    source: ConversationSource;
  }) {
    return this.resolveMentionedUserIds(
      input.body,
      input.source,
      input.authorUserId,
      input.resolver,
    );
  }

  async publishMessageAfterCommit(input: {
    authorUserId: string;
    conversation: Conversation;
    mentionUserIds: string[];
    message: ConversationMessage;
    resolver: ConversationAccessResolver;
    source: ConversationSource;
  }) {
    this.requireSourceWorkspace(input.source);
    input.message.authorUser =
      (await this.userRepositoryForContext().findOne({
        where: { id: input.authorUserId },
      })) ??
      null;
    const participantIds = await this.findParticipantUserIds(
      input.source.workspaceId,
      input.conversation.id,
    );
    const recipientIds = excludeUserIds(
      participantIds.filter((id) => id !== input.authorUserId),
      input.mentionUserIds,
    );
    await this.runNonCriticalSideEffect(
      "notify conversation participants",
      async () =>
        this.notifyUsers(recipientIds, input.conversation, input.source, input.message, {
          body: input.message.body,
          title: `会话新消息：${input.conversation.subject}`,
        }, input.resolver),
    );
    await this.runNonCriticalSideEffect(
      "notify conversation mentions",
      async () =>
        this.notifyMentions(
          input.mentionUserIds,
          input.conversation,
          input.source,
          input.message,
          input.resolver,
        ),
    );
    await this.runNonCriticalSideEffect(
      "publish conversation message",
      async () => {
        await this.publishMessage(
          [input.authorUserId, ...recipientIds, ...input.mentionUserIds],
          input.conversation,
          input.message,
        );
      },
    );
  }
  async addParticipants(input: {
    conversationId: string;
    joinedReason: ConversationParticipantJoinedReason;
    workspaceId: string;
    userIds: string[];
  }) {
    await this.withManager((manager) =>
      this.addParticipantsWithManager(manager, input),
    );
  }

  private async addParticipantsWithManager(
    manager: EntityManager,
    input: {
      conversationId: string;
      joinedReason: ConversationParticipantJoinedReason;
      workspaceId: string;
      userIds: string[];
    },
  ) {
    const userIds = [...new Set(input.userIds)].filter(Boolean);
    if (userIds.length === 0) return;
    const existing = await manager.find(ConversationParticipant, {
      where: {
        conversationId: input.conversationId,
        workspaceId: input.workspaceId,
        userId: In(userIds),
      },
    });
    const existingIds = new Set(existing.map((item) => item.userId));
    const next = userIds
      .filter((userId) => !existingIds.has(userId))
      .map((userId) =>
        this.participantRepositoryForContext().create({
          conversationId: input.conversationId,
          joinedReason: input.joinedReason,
          lastReadAt: null,
          role: "participant",
          workspaceId: input.workspaceId,
          userId,
        }),
      );
    if (next.length > 0) {
      await manager
        .createQueryBuilder()
        .insert()
        .into(ConversationParticipant)
        .values(next)
        .orIgnore()
        .execute();
    }
  }

  async markRead(input: {
    resolver: ConversationAccessResolver;
    source: ConversationSource;
    userId: string;
  }) {
    if (!(await input.resolver.canRead(input.userId, input.source))) {
      throw new ForbiddenException("没有访问该会话的权限");
    }
    const conversation = await this.ensureConversationForSource(input.source);
    await this.notificationsService.markSourceRead(
      input.userId,
      input.source.sourceType,
      input.source.sourceId,
    );
    await this.participantRepositoryForContext().update(
      {
        conversationId: conversation.id,
        workspaceId: input.source.workspaceId,
        userId: input.userId,
      },
      { lastReadAt: new Date() },
    );
    return { ok: true };
  }

  async importMessagesIfEmpty(input: {
    conversationId: string;
    workspaceId: string;
    messages: Array<{
      attachments?: ConversationMessageAttachment[] | null;
      authorUserId?: string | null;
      body: string;
      createdAt?: Date;
      id?: string;
      kind?: "message" | "system";
      updatedAt?: Date;
    }>;
  }) {
    if (input.messages.length === 0) return { imported: 0 };
    const existingCount = await this.messageRepositoryForContext().count({
      where: { conversationId: input.conversationId, workspaceId: input.workspaceId },
    });
    if (existingCount > 0) return { imported: 0 };

    const rows = input.messages.map((message) =>
      this.messageRepositoryForContext().create({
        attachments: message.attachments ?? null,
        authorUserId: message.authorUserId ?? null,
        body: message.body,
        conversationId: input.conversationId,
        createdAt: message.createdAt,
        kind: message.kind ?? "message",
        metadata: message.id ? { legacyTicketMessageId: message.id } : null,
        workspaceId: input.workspaceId,
        updatedAt: message.updatedAt,
      }),
    );
    await this.messageRepositoryForContext().save(rows);

    const lastMessage = rows.at(-1);
    if (lastMessage) {
      await this.conversationRepositoryForContext().update(
        { id: input.conversationId, workspaceId: input.workspaceId },
        { lastMessageAt: lastMessage.createdAt },
      );
    }
    return { imported: rows.length };
  }

  async publishSourceUpdated(source: ConversationSource, payload: unknown) {
    this.requireSourceWorkspace(source);
    const conversation = await this.ensureConversationForSource(source);
    const recipients = await this.findParticipantUserIds(
      source.workspaceId,
      conversation.id,
    );
    await this.runNonCriticalSideEffect(
      "publish conversation source update",
      async () => {
        await this.realtimeEventBus.publishToUsers(recipients, {
          type: "conversation.source.updated",
          payload: {
            conversation: toConversationDto(conversation),
            source,
            sourcePayload: payload,
          },
        });
      },
    );
  }

  async isParticipant(source: ConversationSource, userId: string) {
    this.requireSourceWorkspace(source);
    const conversation = await this.conversationRepositoryForContext().findOne({
      where: {
        sourceId: source.sourceId,
        sourceType: source.sourceType,
        workspaceId: source.workspaceId,
      },
    });
    if (!conversation) return false;
    return Boolean(
      await this.participantRepositoryForContext().findOne({
        where: { conversationId: conversation.id, workspaceId: source.workspaceId, userId },
      }),
    );
  }

  async listParticipantSourceIds(input: {
    sourceType: string;
    workspaceId: string;
    userId: string;
  }) {
    this.requireWorkspaceId(input.workspaceId);
    const participants = await this.participantRepositoryForContext().find({
      where: { workspaceId: input.workspaceId, userId: input.userId },
    });
    if (participants.length === 0) return [];

    const where = {
      id: In(participants.map((participant) => participant.conversationId)),
      sourceType: input.sourceType,
      workspaceId: input.workspaceId,
    };
    const conversations = await this.conversationRepositoryForContext().find({ where });
    return conversations.map((conversation) => conversation.sourceId);
  }

  async getConversationOrThrow(workspaceId: string, conversationId: string) {
    this.requireWorkspaceId(workspaceId);
    const conversation = await this.conversationRepositoryForContext().findOne({
      where: { id: conversationId, workspaceId },
    });
    if (!conversation) throw new NotFoundException("会话不存在");
    return conversation;
  }

  private async syncConversation(
    conversation: Conversation,
    source: ConversationSource,
    manager: EntityManager = this.managerForContext(),
  ) {
    this.requireSourceWorkspace(source);
    let changed = false;
    if (conversation.subject !== source.subject) {
      conversation.subject = source.subject;
      changed = true;
    }
    if (conversation.status !== (source.status ?? conversation.status)) {
      conversation.status = source.status ?? conversation.status;
      changed = true;
    }
    return changed ? manager.save(Conversation, conversation) : conversation;
  }

  private async resolveMentionedUserIds(
    body: string,
    source: ConversationSource,
    authorUserId: string,
    resolver: ConversationAccessResolver,
  ) {
    const mentions = extractMentions(body);
    if (mentions.length === 0) return [];
    if (resolver.resolveMentionCandidates) {
      return [
        ...new Set(
          (await resolver.resolveMentionCandidates(mentions, source, authorUserId))
            .filter((userId) => userId !== authorUserId),
        ),
      ];
    }

    this.requireSourceWorkspace(source);
    const users = await this.userRepositoryForContext().find({
      where: [
        { email: In(mentions) },
        { username: In(mentions) },
      ],
    });
    const candidateIds = users
      .filter((user) => user.id !== authorUserId && user.status === "active")
      .map((user) => user.id);
    return candidateIds;
  }

  private async findParticipantUserIds(workspaceId: string, conversationId: string) {
    const participants = await this.participantRepositoryForContext().find({
      where: { conversationId, workspaceId },
    });
    return participants.map((participant) => participant.userId);
  }

  private async notifyUsers(
    userIds: string[],
    conversation: Conversation,
    source: ConversationSource,
    message: ConversationMessage,
    fallback: ConversationNotificationPayload,
    resolver: ConversationAccessResolver,
  ) {
    if (userIds.length === 0) return;
    const payload =
      resolver.buildNotificationPayload?.({
        conversation,
        kind: "message",
        message,
        source,
      }) ?? fallback;
    await this.notificationsService.createForUsers(userIds, {
      body: payload.body,
      kind: "info",
      payload: {
        conversationId: conversation.id,
        sourceId: source.sourceId,
        sourceType: source.sourceType,
      },
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      title: payload.title,
    });
  }

  private async notifyMentions(
    userIds: string[],
    conversation: Conversation,
    source: ConversationSource,
    message: ConversationMessage,
    resolver: ConversationAccessResolver,
  ) {
    const recipients = [...new Set(userIds)];
    if (recipients.length === 0) return;
    const payload =
      resolver.buildNotificationPayload?.({
        conversation,
        kind: "mention",
        message,
        source,
      }) ?? {
        body: message.body,
        title: `有人在会话中提到了你：${conversation.subject}`,
      };
    await this.notificationsService.createForUsers(recipients, {
      body: payload.body,
      kind: "info",
      payload: {
        conversationId: conversation.id,
        sourceId: source.sourceId,
        sourceType: source.sourceType,
      },
      sourceId: source.sourceId,
      sourceType: source.sourceType,
      title: payload.title,
    });
  }

  private async publishMessage(
    userIds: string[],
    conversation: Conversation,
    message: ConversationMessage,
  ) {
    await this.realtimeEventBus.publishToUsers(userIds, {
      type: "conversation.message.created",
      payload: {
        conversation: toConversationDto(conversation),
        message: toConversationMessageDto(message, conversation),
      },
    });
  }

  private requireSourceWorkspace(source: ConversationSource) {
    return this.requireWorkspaceId(source.workspaceId);
  }

  private requireWorkspaceId(workspaceId: string) {
    const normalized = workspaceId?.trim();
    if (!normalized) throw new NotFoundException("会话不存在");
    const context = this.workspaceContext?.current(false);
    if (context && context.workspaceId !== normalized) {
      throw new NotFoundException("会话不存在");
    }
    return normalized;
  }

  private managerForContext() {
    return this.workspaceContext?.current(false)?.manager ?? this.conversationRepository.manager;
  }

  private withManager<T>(work: (manager: EntityManager) => Promise<T>) {
    const context = this.workspaceContext?.current(false);
    if (context) return work(context.manager);
    const manager = this.conversationRepository.manager;
    return typeof manager.transaction === "function"
      ? manager.transaction(work)
      : work(manager);
  }

  private conversationRepositoryForContext() {
    return this.workspaceContext?.current(false)
      ? this.workspaceContext.repository(Conversation)
      : this.conversationRepository;
  }

  private messageRepositoryForContext() {
    return this.workspaceContext?.current(false)
      ? this.workspaceContext.repository(ConversationMessage)
      : this.messageRepository;
  }

  private participantRepositoryForContext() {
    return this.workspaceContext?.current(false)
      ? this.workspaceContext.repository(ConversationParticipant)
      : this.participantRepository;
  }

  private userRepositoryForContext() {
    return this.workspaceContext?.current(false)
      ? this.workspaceContext.repository(Account)
      : this.userRepository;
  }

  private async runNonCriticalSideEffect(
    label: string,
    action: () => Promise<void> | void,
  ) {
    try {
      await action();
    } catch (error) {
      this.logger.warn(
        `${label} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

function toConversationDto(conversation: Conversation) {
  return {
    createdAt: conversation.createdAt,
    id: conversation.id,
    lastMessageAt: conversation.lastMessageAt,
    sourceId: conversation.sourceId,
    sourceType: conversation.sourceType,
    status: conversation.status,
    subject: conversation.subject,
    workspaceId: conversation.workspaceId,
    updatedAt: conversation.updatedAt,
  };
}

export function toConversationMessageDto(
  message: ConversationMessage,
  conversation: Conversation,
) {
  return {
    attachments: message.attachments ?? [],
    author: message.authorUser
      ? {
          avatarUrl: message.authorUser.avatarUrl,
          displayName: message.authorUser.displayName,
          email: message.authorUser.email,
          id: message.authorUser.id,
          imageUrl: message.authorUser.imageUrl,
          username: message.authorUser.username,
        }
      : null,
    authorUserId: message.authorUserId,
    body: message.body,
    conversationId: message.conversationId,
    createdAt: message.createdAt,
    id: message.id,
    kind: message.kind,
    metadata: message.metadata,
    sourceId: conversation.sourceId,
    sourceType: conversation.sourceType,
    updatedAt: message.updatedAt,
  };
}

function extractMentions(body: string) {
  const mentions = new Set<string>();
  for (const match of body.matchAll(/@([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|[a-zA-Z0-9_.-]+)/g)) {
    const value = match[1]?.trim().toLowerCase();
    if (value) mentions.add(value);
  }
  return [...mentions];
}

function excludeUserIds(userIds: string[], excludedUserIds: string[]) {
  if (excludedUserIds.length === 0) return userIds;
  const excluded = new Set(excludedUserIds);
  return userIds.filter((userId) => !excluded.has(userId));
}

function isUniqueConstraintError(error: unknown) {
  const typed = error as { code?: string; driverError?: { code?: string } };
  return typed.code === "23505" || typed.driverError?.code === "23505";
}
