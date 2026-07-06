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
});

function readInValues(value: unknown): string[] | null {
  if (!value || typeof value !== "object") return null;
  const operator = value as { _value?: unknown };
  return Array.isArray(operator._value) ? operator._value : null;
}
