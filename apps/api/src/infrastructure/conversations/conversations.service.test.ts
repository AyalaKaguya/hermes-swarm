import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ConversationCapabilityService } from "./conversations.service.js";
import type {
  ConversationAccessResolver,
  ConversationSource,
} from "./conversation-access-resolver.js";

describe("ConversationCapabilityService", () => {
  it("adds senders and mentions as participants while notifying only eligible recipients", async () => {
    const conversations: any[] = [];
    const messages: any[] = [];
    const participants: any[] = [];
    const notifications: any[] = [];
    const realtimeEvents: any[] = [];
    const conversationRepo = {
      create: (value: any) => ({
        createdAt: new Date("2026-07-06T00:00:00Z"),
        id: `conversation-${conversations.length + 1}`,
        updatedAt: new Date("2026-07-06T00:00:00Z"),
        ...value,
      }),
      findOne: async ({ where }: any) =>
        conversations.find(
          (conversation) =>
            conversation.sourceId === where.sourceId &&
            conversation.sourceType === where.sourceType,
        ) ?? null,
      save: async (value: any) => {
        const index = conversations.findIndex(
          (conversation) => conversation.id === value.id,
        );
        if (index >= 0) conversations[index] = value;
        else conversations.push(value);
        return value;
      },
      manager: {
        async transaction(callback: (manager: any) => Promise<unknown>) {
          const snapshots = {
            conversations: conversations.map((item) => ({ ...item })),
            messages: messages.map((item) => ({ ...item })),
            participants: participants.map((item) => ({ ...item })),
          };
          try {
            return await callback({
              async find(target: { name?: string }, { where }: any) {
                if (target.name !== "ConversationParticipant") return [];
                const userIds = readInValues(where.userId);
                return participants.filter(
                  (participant) =>
                    participant.conversationId === where.conversationId &&
                    (!userIds || userIds.includes(participant.userId)),
                );
              },
              async findOne(target: { name?: string }, { where }: any) {
                if (target.name !== "Conversation") return null;
                return (
                  conversations.find(
                    (conversation) =>
                      conversation.sourceId === where.sourceId &&
                      conversation.sourceType === where.sourceType,
                  ) ?? null
                );
              },
              async save(target: { name?: string }, value: any) {
                if (target.name === "Conversation") {
                  const index = conversations.findIndex(
                    (conversation) => conversation.id === value.id,
                  );
                  if (index >= 0) conversations[index] = value;
                  else conversations.push(value);
                  return value;
                }
                if (target.name === "ConversationMessage") {
                  messages.push(value);
                  return value;
                }
                if (target.name === "ConversationParticipant") {
                  participants.push(...value);
                  return value;
                }
                return value;
              },
              createQueryBuilder: () =>
                createParticipantInsertQueryBuilder(participants),
            });
          } catch (error) {
            conversations.splice(
              0,
              conversations.length,
              ...snapshots.conversations,
            );
            messages.splice(0, messages.length, ...snapshots.messages);
            participants.splice(
              0,
              participants.length,
              ...snapshots.participants,
            );
            throw error;
          }
        },
      },
    };
    const messageRepo = {
      create: (value: any) => ({
        attachments: null,
        authorUser: null,
        createdAt: new Date(`2026-07-06T00:0${messages.length + 1}:00Z`),
        id: `message-${messages.length + 1}`,
        kind: "message",
        metadata: null,
        updatedAt: new Date(`2026-07-06T00:0${messages.length + 1}:00Z`),
        ...value,
      }),
      find: async ({ where }: any) =>
        messages.filter((message) => message.conversationId === where.conversationId),
      save: async (value: any) => {
        messages.push(value);
        return value;
      },
    };
    const participantRepo = {
      create: (value: any) => ({
        createdAt: new Date("2026-07-06T00:00:00Z"),
        id: `participant-${participants.length + 1}`,
        updatedAt: new Date("2026-07-06T00:00:00Z"),
        ...value,
      }),
      find: async ({ where }: any) => {
        const userIds = readInValues(where.userId);
        return participants.filter(
          (participant) =>
            participant.conversationId === where.conversationId &&
            (!userIds || userIds.includes(participant.userId)),
        );
      },
      findOne: async ({ where }: any) =>
        participants.find(
          (participant) =>
            participant.conversationId === where.conversationId &&
            participant.userId === where.userId,
        ) ?? null,
      save: async (values: any[]) => {
        participants.push(...values);
        return values;
      },
      update: async () => undefined,
    };
    const userRepo = {
      find: async () => [
        {
          email: "mentioned@example.com",
          id: "mentioned",
          status: "active",
          username: "mentioned",
        },
      ],
      findOne: async ({ where }: any) => ({
        avatarUrl: null,
        displayName: where.id,
        email: `${where.id}@example.com`,
        id: where.id,
        imageUrl: null,
        username: where.id,
      }),
    };
    const membershipRepo = {
      find: async ({ where }: any) => {
        const userIds = readInValues(where.userId) ?? [];
        return userIds
          .filter((userId) => ["mentioned", "requester", "handler"].includes(userId))
          .map((userId) => ({
            organizationId: where.organizationId,
            status: "active",
            userId,
          }));
      },
    };
    const service = new ConversationCapabilityService(
      conversationRepo as any,
      messageRepo as any,
      participantRepo as any,
      userRepo as any,
      membershipRepo as any,
      {
        createForUsers: async (userIds: string[], input: any) => {
          notifications.push({ input, userIds });
          return [];
        },
        markSourceRead: async () => undefined,
      } as any,
      {
        publishToUsers: (userIds: string[], event: unknown) => {
          realtimeEvents.push({ event, userIds });
        },
      } as any,
    );
    const source: ConversationSource = {
      organizationId: "org-1",
      scope: "organization",
      sourceId: "ticket-1",
      sourceType: "ticket",
      status: "open",
      subject: "Need help",
      tenantId: "tenant-1",
    };
    const resolver: ConversationAccessResolver = {
      buildNotificationPayload: (input) =>
        input.kind === "mention"
          ? { body: input.message.body, title: "提及通知" }
          : { body: input.message.body, title: "普通通知" },
      canRead: async () => true,
      canWrite: async () => true,
    };

    await service.sendMessage({
      authorUserId: "requester",
      message: {
        attachments: [{ name: "shot.png", type: "image", url: "/shot.png" }],
        body: "please check @mentioned@example.com",
      },
      resolver,
      source,
    });

    assert.deepEqual(
      participants.map((participant) => participant.userId).sort(),
      ["mentioned", "requester"],
    );
    assert.equal(conversations[0]?.tenantId, "tenant-1");
    assert.deepEqual(notifications[0].userIds, ["mentioned"]);
    assert.equal(notifications[0].input.title, "提及通知");
    assert.deepEqual(realtimeEvents[0].userIds.sort(), [
      "mentioned",
      "requester",
    ]);

    await service.sendMessage({
      authorUserId: "handler",
      message: { body: "I joined the conversation" },
      resolver,
      source,
    });

    assert.deepEqual(
      participants.map((participant) => participant.userId).sort(),
      ["handler", "mentioned", "requester"],
    );
    assert.deepEqual(notifications[1].userIds.sort(), [
      "mentioned",
      "requester",
    ]);
    assert.equal(notifications[1].input.title, "普通通知");
    assert.deepEqual(realtimeEvents[1].userIds.sort(), [
      "handler",
      "mentioned",
      "requester",
    ]);
  });

  it("does not notify or publish when message persistence rolls back", async () => {
    const harness = createConversationHarness({ failMessageSave: true });
    const source: ConversationSource = {
      organizationId: "org-1",
      scope: "organization",
      sourceId: "ticket-rollback",
      sourceType: "ticket",
      status: "open",
      subject: "Rollback test",
      tenantId: "tenant-1",
    };
    const resolver: ConversationAccessResolver = {
      canRead: async () => true,
      canWrite: async () => true,
    };

    await assert.rejects(() =>
      harness.service.sendMessage({
        authorUserId: "requester",
        message: { body: "this should rollback" },
        resolver,
        source,
      }),
    );

    assert.equal(harness.conversations.length, 0);
    assert.equal(harness.messages.length, 0);
    assert.equal(harness.participants.length, 0);
    assert.equal(harness.notifications.length, 0);
    assert.equal(harness.realtimeEvents.length, 0);
  });

  it("keeps persisted messages when notification and realtime side effects fail", async () => {
    const notificationHarness = createConversationHarness({
      failNotifications: true,
    });
    const realtimeHarness = createConversationHarness({
      failRealtime: true,
    });
    const source: ConversationSource = {
      organizationId: "org-1",
      scope: "organization",
      sourceId: "ticket-side-effects",
      sourceType: "ticket",
      status: "open",
      subject: "Side effects",
      tenantId: "tenant-1",
    };
    const resolver: ConversationAccessResolver = {
      canRead: async () => true,
      canWrite: async () => true,
    };

    await notificationHarness.service.sendMessage({
      authorUserId: "requester",
      message: { body: "hello @mentioned@example.com" },
      resolver: {
        ...resolver,
        resolveMentionCandidates: async () => ["mentioned"],
      },
      source,
    });
    await realtimeHarness.service.sendMessage({
      authorUserId: "requester",
      message: { body: "hello" },
      resolver,
      source: { ...source, sourceId: "ticket-realtime-failure" },
    });

    assert.equal(notificationHarness.messages.length, 1);
    assert.equal(realtimeHarness.messages.length, 1);
  });

  it("returns the concurrently created conversation when source creation races", async () => {
    const existingConversation = {
      createdAt: new Date("2026-07-06T00:00:00Z"),
      id: "conversation-existing",
      lastMessageAt: null,
      organizationId: "org-1",
      scope: "organization",
      sourceId: "ticket-1",
      sourceType: "ticket",
      status: "closed",
      subject: "Old subject",
      tenantId: "tenant-1",
      updatedAt: new Date("2026-07-06T00:00:00Z"),
    };
    let firstLookup = true;
    const service = new ConversationCapabilityService(
      {
        create: (value: any) => value,
        manager: {
          findOne: async () => {
            if (firstLookup) {
              firstLookup = false;
              return null;
            }
            return existingConversation;
          },
          save: async (_target: { name?: string }, value: any) => {
            if (!value.id) {
              throw { driverError: { code: "23505" } };
            }
            Object.assign(existingConversation, value);
            return existingConversation;
          },
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const result = await service.ensureConversationForSource({
      organizationId: "org-1",
      scope: "organization",
      sourceId: "ticket-1",
      sourceType: "ticket",
      status: "open",
      subject: "Current subject",
      tenantId: "tenant-1",
    });

    assert.equal(result.id, "conversation-existing");
    assert.equal(result.subject, "Current subject");
    assert.equal(result.status, "open");
  });

  it("keeps participant insertion idempotent when a participant already exists", async () => {
    const harness = createConversationHarness();
    const source: ConversationSource = {
      organizationId: "org-1",
      scope: "organization",
      sourceId: "ticket-idempotent",
      sourceType: "ticket",
      status: "open",
      subject: "Idempotent participants",
      tenantId: "tenant-1",
    };
    const resolver: ConversationAccessResolver = {
      canRead: async () => true,
      canWrite: async () => true,
    };

    await harness.service.sendMessage({
      authorUserId: "requester",
      message: { body: "first" },
      resolver,
      source,
    });
    await harness.service.sendMessage({
      authorUserId: "requester",
      message: { body: "second" },
      resolver,
      source,
    });

    assert.deepEqual(
      harness.participants.map((participant) => participant.userId),
      ["requester"],
    );
  });
});

function readInValues(value: unknown): string[] | null {
  if (!value || typeof value !== "object") return null;
  const operator = value as { _value?: unknown };
  return Array.isArray(operator._value) ? operator._value : null;
}

function createConversationHarness(
  options: {
    failMessageSave?: boolean;
    failNotifications?: boolean;
    failRealtime?: boolean;
  } = {},
) {
  const conversations: any[] = [];
  const messages: any[] = [];
  const participants: any[] = [];
  const notifications: any[] = [];
  const realtimeEvents: any[] = [];
  const transactionManager = {
    async find(target: { name?: string }, { where }: any) {
      if (target.name !== "ConversationParticipant") return [];
      const userIds = readInValues(where.userId);
      return participants.filter(
        (participant) =>
          participant.conversationId === where.conversationId &&
          (!userIds || userIds.includes(participant.userId)),
      );
    },
    async findOne(target: { name?: string }, { where }: any) {
      if (target.name !== "Conversation") return null;
      return (
        conversations.find(
          (conversation) =>
            conversation.sourceId === where.sourceId &&
            conversation.sourceType === where.sourceType,
        ) ?? null
      );
    },
    async save(target: { name?: string }, value: any) {
      if (target.name === "Conversation") {
        const conversation = {
          createdAt: new Date("2026-07-06T00:00:00Z"),
          id: `conversation-${conversations.length + 1}`,
          updatedAt: new Date("2026-07-06T00:00:00Z"),
          ...value,
        };
        const index = conversations.findIndex((item) => item.id === value.id);
        if (index >= 0) conversations[index] = conversation;
        else conversations.push(conversation);
        return conversation;
      }
      if (target.name === "ConversationMessage") {
        if (options.failMessageSave) throw new Error("message save failed");
        const message = {
          createdAt: new Date("2026-07-06T00:01:00Z"),
          id: `message-${messages.length + 1}`,
          kind: "message",
          updatedAt: new Date("2026-07-06T00:01:00Z"),
          ...value,
        };
        messages.push(message);
        return message;
      }
      if (target.name === "ConversationParticipant") {
        participants.push(...value);
        return value;
      }
      return value;
    },
    createQueryBuilder: () => createParticipantInsertQueryBuilder(participants),
  };
  const conversationRepo = {
    create: (value: any) => value,
    manager: {
      async transaction(callback: (manager: any) => Promise<unknown>) {
        const snapshots = {
          conversations: conversations.map((item) => ({ ...item })),
          messages: messages.map((item) => ({ ...item })),
          participants: participants.map((item) => ({ ...item })),
        };
        try {
          return await callback(transactionManager);
        } catch (error) {
          conversations.splice(
            0,
            conversations.length,
            ...snapshots.conversations,
          );
          messages.splice(0, messages.length, ...snapshots.messages);
          participants.splice(
            0,
            participants.length,
            ...snapshots.participants,
          );
          throw error;
        }
      },
      ...transactionManager,
    },
  };
  const service = new ConversationCapabilityService(
    conversationRepo as any,
    { create: (value: any) => value } as any,
    {
      create: (value: any) => ({
        id: `participant-${participants.length + 1}`,
        ...value,
      }),
      find: async ({ where }: any) =>
        participants.filter(
          (participant) => participant.conversationId === where.conversationId,
        ),
    } as any,
    {
      find: async () => [],
      findOne: async ({ where }: any) => ({
        avatarUrl: null,
        displayName: where.id,
        email: `${where.id}@example.com`,
        id: where.id,
        imageUrl: null,
        username: where.id,
      }),
    } as any,
    { find: async () => [] } as any,
    {
      createForUsers: async (userIds: string[], input: any) => {
        if (options.failNotifications) {
          throw new Error("notification failed");
        }
        notifications.push({ input, userIds });
      },
      markSourceRead: async () => undefined,
    } as any,
    {
      publishToUsers: (userIds: string[], event: unknown) => {
        if (options.failRealtime) {
          throw new Error("realtime failed");
        }
        realtimeEvents.push({ event, userIds });
      },
    } as any,
  );
  return {
    conversations,
    messages,
    notifications,
    participants,
    realtimeEvents,
    service,
  };
}

function createParticipantInsertQueryBuilder(participants: any[]) {
  let pendingValues: any[] = [];
  return {
    execute: async () => {
      for (const participant of pendingValues) {
        const exists = participants.some(
          (item) =>
            item.conversationId === participant.conversationId &&
            item.userId === participant.userId,
        );
        if (!exists) participants.push(participant);
      }
      return { identifiers: [], generatedMaps: [], raw: [] };
    },
    insert() {
      return this;
    },
    into() {
      return this;
    },
    orIgnore() {
      return this;
    },
    values(values: any | any[]) {
      pendingValues = Array.isArray(values) ? values : [values];
      return this;
    },
  };
}
