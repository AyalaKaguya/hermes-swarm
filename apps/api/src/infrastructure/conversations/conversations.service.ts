import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  Conversation,
  ConversationMessage,
  ConversationParticipant,
  User,
  UserOrganization,
  type ConversationMessageAttachment,
  type ConversationParticipantJoinedReason,
} from "@hermes-swarm/core";
import {
  In,
  IsNull,
  Repository,
  type EntityManager,
  type FindOptionsWhere,
} from "typeorm";
import { NotificationsService } from "../notifications/notifications.service.js";
import { RealtimeService } from "../realtime/realtime.service.js";
import type {
  ConversationAccessResolver,
  ConversationMessageInput,
  ConversationNotificationPayload,
  ConversationSource,
} from "./conversation-access-resolver.js";

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
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @Inject(NotificationsService)
    private readonly notificationsService: NotificationsService,
    @Inject(RealtimeService)
    private readonly realtimeService: RealtimeService,
  ) {}

  async ensureConversationForSource(source: ConversationSource) {
    return this.ensureConversationForSourceWithManager(
      source,
      this.conversationRepository.manager,
    );
  }

  private async ensureConversationForSourceWithManager(
    source: ConversationSource,
    manager: EntityManager,
  ) {
    const existing = await manager.findOne(Conversation, {
      where: { sourceId: source.sourceId, sourceType: source.sourceType },
    });
    if (existing) return this.syncConversation(existing, source, manager);

    try {
      return await manager.save(
        Conversation,
        this.conversationRepository.create({
          lastMessageAt: null,
          organizationId: source.organizationId ?? null,
          scope: source.scope,
          sourceId: source.sourceId,
          sourceType: source.sourceType,
          status: source.status ?? "open",
          subject: source.subject,
        }),
      );
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const concurrent = await manager.findOne(Conversation, {
        where: { sourceId: source.sourceId, sourceType: source.sourceType },
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
    if (!(await input.resolver.canRead(input.userId, input.source))) {
      throw new ForbiddenException("没有访问该会话的权限");
    }
    const conversation = await this.ensureConversationForSource(input.source);
    const messages = await this.messageRepository.find({
      order: { createdAt: "ASC" },
      relations: { authorUser: true },
      where: { conversationId: conversation.id },
    });
    return messages.map((message) => toConversationMessageDto(message, conversation));
  }

  async sendMessage(input: {
    authorUserId: string;
    message: ConversationMessageInput;
    resolver: ConversationAccessResolver;
    source: ConversationSource;
  }) {
    if (!(await input.resolver.canWrite(input.authorUserId, input.source))) {
      throw new ForbiddenException("没有发送会话消息的权限");
    }

    const mentionUserIds = await this.resolveMentionedUserIds(
      input.message.body,
      input.source,
      input.authorUserId,
      input.resolver,
    );

    let conversation!: Conversation;
    let message!: ConversationMessage;
    await this.conversationRepository.manager.transaction(async (manager) => {
      const conversationInTransaction =
        await this.ensureConversationForSourceWithManager(input.source, manager);
      await this.addParticipantsWithManager(manager, {
        conversationId: conversationInTransaction.id,
        joinedReason: "reply",
        userIds: [input.authorUserId],
      });
      await this.addParticipantsWithManager(manager, {
        conversationId: conversationInTransaction.id,
        joinedReason: "mention",
        userIds: mentionUserIds,
      });

      message = await manager.save(
        ConversationMessage,
        this.messageRepository.create({
          attachments: input.message.attachments ?? null,
          authorUserId: input.authorUserId,
          body: input.message.body,
          conversationId: conversationInTransaction.id,
          kind: "message",
          metadata: input.message.metadata ?? null,
        }),
      );

      conversationInTransaction.lastMessageAt = message.createdAt;
      conversationInTransaction.status =
        input.source.status ?? conversationInTransaction.status;
      conversation = await manager.save(Conversation, conversationInTransaction);
    });
    message.authorUser =
      (await this.userRepository.findOne({ where: { id: input.authorUserId } })) ??
      null;

    const participantIds = await this.findParticipantUserIds(conversation.id);
    const recipientIds = excludeUserIds(
      participantIds.filter((id) => id !== input.authorUserId),
      mentionUserIds,
    );
    await this.runNonCriticalSideEffect(
      "notify conversation participants",
      async () =>
        this.notifyUsers(recipientIds, conversation, input.source, message, {
          body: message.body,
          title: `会话新消息：${conversation.subject}`,
        }, input.resolver),
    );
    await this.runNonCriticalSideEffect(
      "notify conversation mentions",
      async () =>
        this.notifyMentions(
          mentionUserIds,
          conversation,
          input.source,
          message,
          input.resolver,
        ),
    );
    await this.runNonCriticalSideEffect(
      "publish conversation message",
      async () => {
        this.publishMessage(
          [input.authorUserId, ...recipientIds, ...mentionUserIds],
          conversation,
          message,
        );
      },
    );

    return toConversationMessageDto(message, conversation);
  }

  async addParticipants(input: {
    conversationId: string;
    joinedReason: ConversationParticipantJoinedReason;
    userIds: string[];
  }) {
    await this.addParticipantsWithManager(this.participantRepository.manager, input);
  }

  private async addParticipantsWithManager(
    manager: EntityManager,
    input: {
      conversationId: string;
      joinedReason: ConversationParticipantJoinedReason;
      userIds: string[];
    },
  ) {
    const userIds = [...new Set(input.userIds)].filter(Boolean);
    if (userIds.length === 0) return;
    const existing = await manager.find(ConversationParticipant, {
      where: { conversationId: input.conversationId, userId: In(userIds) },
    });
    const existingIds = new Set(existing.map((item) => item.userId));
    const next = userIds
      .filter((userId) => !existingIds.has(userId))
      .map((userId) =>
        this.participantRepository.create({
          conversationId: input.conversationId,
          joinedReason: input.joinedReason,
          lastReadAt: null,
          role: "participant",
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
    await this.participantRepository.update(
      { conversationId: conversation.id, userId: input.userId },
      { lastReadAt: new Date() },
    );
    return { ok: true };
  }

  async importMessagesIfEmpty(input: {
    conversationId: string;
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
    const existingCount = await this.messageRepository.count({
      where: { conversationId: input.conversationId },
    });
    if (existingCount > 0) return { imported: 0 };

    const rows = input.messages.map((message) =>
      this.messageRepository.create({
        attachments: message.attachments ?? null,
        authorUserId: message.authorUserId ?? null,
        body: message.body,
        conversationId: input.conversationId,
        createdAt: message.createdAt,
        kind: message.kind ?? "message",
        metadata: message.id ? { legacyTicketMessageId: message.id } : null,
        updatedAt: message.updatedAt,
      }),
    );
    await this.messageRepository.save(rows);

    const lastMessage = rows.at(-1);
    if (lastMessage) {
      await this.conversationRepository.update(
        { id: input.conversationId },
        { lastMessageAt: lastMessage.createdAt },
      );
    }
    return { imported: rows.length };
  }

  async publishSourceUpdated(source: ConversationSource, payload: unknown) {
    const conversation = await this.ensureConversationForSource(source);
    const recipients = await this.findParticipantUserIds(conversation.id);
    await this.runNonCriticalSideEffect(
      "publish conversation source update",
      async () => {
        this.realtimeService.publishToUsers(recipients, {
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
    const conversation = await this.conversationRepository.findOne({
      where: { sourceId: source.sourceId, sourceType: source.sourceType },
    });
    if (!conversation) return false;
    return Boolean(
      await this.participantRepository.findOne({
        where: { conversationId: conversation.id, userId },
      }),
    );
  }

  async listParticipantSourceIds(input: {
    organizationId?: string | null;
    scope?: Conversation["scope"];
    sourceType: string;
    userId: string;
  }) {
    const participants = await this.participantRepository.find({
      where: { userId: input.userId },
    });
    if (participants.length === 0) return [];

    const where: FindOptionsWhere<Conversation> = {
      id: In(participants.map((participant) => participant.conversationId)),
      sourceType: input.sourceType,
    };
    if (input.organizationId !== undefined) {
      where.organizationId = input.organizationId ?? IsNull();
    }
    if (input.scope) {
      where.scope = input.scope;
    }
    const conversations = await this.conversationRepository.find({ where });
    return conversations.map((conversation) => conversation.sourceId);
  }

  async getConversationOrThrow(conversationId: string) {
    const conversation = await this.conversationRepository.findOne({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException("会话不存在");
    return conversation;
  }

  private async syncConversation(
    conversation: Conversation,
    source: ConversationSource,
    manager: EntityManager = this.conversationRepository.manager,
  ) {
    let changed = false;
    if (conversation.subject !== source.subject) {
      conversation.subject = source.subject;
      changed = true;
    }
    if (conversation.status !== (source.status ?? conversation.status)) {
      conversation.status = source.status ?? conversation.status;
      changed = true;
    }
    if (conversation.organizationId !== (source.organizationId ?? null)) {
      conversation.organizationId = source.organizationId ?? null;
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

    const users = await this.userRepository.find({
      where: [{ email: In(mentions) }, { username: In(mentions) }],
    });
    const candidateIds = users
      .filter((user) => user.id !== authorUserId && user.status === "active")
      .map((user) => user.id);
    if (candidateIds.length === 0) return [];
    if (source.scope === "platform") return candidateIds;
    if (!source.organizationId) return [];
    const memberships = await this.membershipRepository.find({
      where: {
        organizationId: source.organizationId,
        status: "active",
        userId: In(candidateIds),
      },
    });
    return memberships.map((membership) => membership.userId);
  }

  private async findParticipantUserIds(conversationId: string) {
    const participants = await this.participantRepository.find({
      where: { conversationId },
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
      organizationId: conversation.organizationId,
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
      organizationId: conversation.organizationId,
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

  private publishMessage(
    userIds: string[],
    conversation: Conversation,
    message: ConversationMessage,
  ) {
    this.realtimeService.publishToUsers(userIds, {
      type: "conversation.message.created",
      payload: {
        conversation: toConversationDto(conversation),
        message: toConversationMessageDto(message, conversation),
      },
    });
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
    organizationId: conversation.organizationId,
    scope: conversation.scope,
    sourceId: conversation.sourceId,
    sourceType: conversation.sourceType,
    status: conversation.status,
    subject: conversation.subject,
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
