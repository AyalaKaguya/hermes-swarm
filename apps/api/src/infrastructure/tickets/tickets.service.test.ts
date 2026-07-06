import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import { TicketsService } from "./tickets.service.js";

const ORG_HANDLE_PERMISSION = "ticket.conversation.handle:organization";
const PLATFORM_HANDLE_PERMISSION =
  "ticket.platform_conversation.list_platform:platform";

const settingsServiceMock = {
  getOrganizationValue: async () => "true",
  getPlatformValue: async () => "true",
};

describe("TicketsService", () => {
  it("delegates ticket messages to the conversation capability", async () => {
    const savedTickets: any[] = [];
    const addParticipantCalls: any[] = [];
    const sendMessageCalls: any[] = [];
    const publishSourceCalls: any[] = [];
    const ticketRepo = {
      create: (value: any) => ({
        archivedAt: null,
        assigneeUserId: null,
        conversationId: null,
        createdAt: new Date("2026-07-06T00:00:00Z"),
        handlerClosedAt: null,
        id: `ticket-${savedTickets.length + 1}`,
        requesterClosedAt: null,
        updatedAt: new Date("2026-07-06T00:00:00Z"),
        ...value,
      }),
      find: async () => [],
      findOne: async ({ where }: any) =>
        savedTickets.find((ticket) => ticket.id === where.id) ?? null,
      save: async (value: any) => {
        const index = savedTickets.findIndex((ticket) => ticket.id === value.id);
        if (index >= 0) savedTickets[index] = value;
        else savedTickets.push(value);
        return value;
      },
    };
    const membershipRepo = {
      find: async () => [],
      findOne: async ({ where }: any) =>
        where.userId === "requester" && where.organizationId === "org-1"
          ? {
              organizationId: "org-1",
              roleId: "member-role",
              status: "active",
              userId: "requester",
            }
          : null,
    };
    const rolePermissionRepo = {
      findOne: async ({ where }: any) =>
        where.roleId === "handler-role" &&
        where.permission === ORG_HANDLE_PERMISSION &&
        where.enabled
          ? { id: "rp-1" }
          : null,
    };
    const conversationsService = {
      addParticipants: async (input: any) => {
        addParticipantCalls.push(input);
      },
      ensureConversationForSource: async () => ({
        id: "conversation-1",
      }),
      importMessagesIfEmpty: async () => ({ imported: 0 }),
      isParticipant: async () => false,
      publishSourceUpdated: async (...input: any[]) => {
        publishSourceCalls.push(input);
      },
      sendMessage: async (input: any) => {
        sendMessageCalls.push(input);
        return {
          attachments: input.message.attachments ?? [],
          author: null,
          authorUserId: input.authorUserId,
          body: input.message.body,
          conversationId: "conversation-1",
          createdAt: new Date("2026-07-06T00:01:00Z"),
          id: `message-${sendMessageCalls.length}`,
          kind: "message",
          metadata: null,
          sourceId: input.source.sourceId,
          sourceType: input.source.sourceType,
          updatedAt: new Date("2026-07-06T00:01:00Z"),
        };
      },
    };

    const service = new TicketsService(
      ticketRepo as any,
      { find: async () => [] } as any,
      membershipRepo as any,
      {} as any,
      rolePermissionRepo as any,
      {
        validateAccessToken: async () => ({
          sessionId: "s1",
          userId: "requester",
        }),
      } as any,
      conversationsService as any,
      {} as any,
      settingsServiceMock as any,
    );

    const result = await service.createOrganizationTicket("Bearer token", "org-1", {
      attachments: [
        { name: "shot.png", type: "image", url: "/api/admin/files/shot.png" },
      ],
      body: "please check @mentioned@example.com",
      subject: "Need help",
    });

    assert.equal(result.subject, "Need help");
    assert.equal(result.conversationId, "conversation-1");
    assert.equal(result.firstMessage.ticketId, "ticket-1");
    assert.equal(savedTickets[0].conversationId, "conversation-1");
    assert.deepEqual(addParticipantCalls[0].userIds, ["requester"]);
    assert.equal(sendMessageCalls[0].source.sourceType, "ticket");
    assert.equal(sendMessageCalls[0].message.attachments[0].name, "shot.png");

    const reply = await service.sendMessage("Bearer token", "ticket-1", {
      body: "I joined the conversation",
    });

    assert.equal(reply.body, "I joined the conversation");
    assert.equal(sendMessageCalls.length, 2);
    assert.equal(publishSourceCalls.length, 1);
    assert.equal(publishSourceCalls[0][0].sourceId, "ticket-1");
  });

  it("uses platform ticket handling permission instead of any platform membership", async () => {
    const platformMemberRepo = {
      findOne: async () => ({
        roleId: "limited-platform-role",
        status: "active",
        userId: "operator",
      }),
    };
    const rolePermissionRepo = {
      findOne: async ({ where }: any) =>
        where.roleId === "limited-platform-role" &&
        where.permission === PLATFORM_HANDLE_PERMISSION
          ? null
          : null,
    };
    const service = new TicketsService(
      {
        find: async () => [],
        findOne: async () => ({
          id: "ticket-1",
          requesterUserId: "other",
          scope: "platform",
          status: "open",
        }),
      } as any,
      { find: async () => [] } as any,
      {} as any,
      platformMemberRepo as any,
      rolePermissionRepo as any,
      {
        validateAccessToken: async () => ({
          sessionId: "s1",
          userId: "operator",
        }),
      } as any,
      {
        importMessagesIfEmpty: async () => ({ imported: 0 }),
        isParticipant: async () => false,
      } as any,
      {} as any,
      settingsServiceMock as any,
    );

    await assert.rejects(
      () => service.getTicket("Bearer token", "ticket-1"),
      ForbiddenException,
    );
  });

  it("archives tickets closed by only one side for more than seven days", async () => {
    const oldClosedTicket = {
      archivedAt: null,
      createdAt: new Date("2026-06-01T00:00:00Z"),
      handlerClosedAt: new Date("2026-06-20T00:00:00Z"),
      id: "ticket-old",
      requesterClosedAt: null,
      status: "closed",
      updatedAt: new Date("2026-06-20T00:00:00Z"),
    };
    const saved: any[] = [];
    const service = new TicketsService(
      {
        find: async () => [oldClosedTicket],
        save: async (values: any[]) => {
          saved.push(...values);
          return values;
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      settingsServiceMock as any,
    );

    const result = await service.archiveExpiredTickets();

    assert.equal(result.archived, 1);
    assert.equal(saved[0].status, "archived");
    assert.ok(saved[0].archivedAt instanceof Date);
  });
});
