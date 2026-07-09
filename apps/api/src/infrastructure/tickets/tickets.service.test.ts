import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { FEATURE_SETTING_KEYS } from "@hermes-swarm/core";
import { TicketsService } from "./tickets.service.js";

const ORG_HANDLE_PERMISSION = "ticket.conversation.handle:organization";
const ORG_HANDLING_FEATURE = FEATURE_SETTING_KEYS.ticketingHandling;
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
    const ticketRepo: any = {
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
    ticketRepo.manager = {
      transaction: async (work: any) =>
        work({
          findOne: async (_entity: any, { where }: any) =>
            savedTickets.find((ticket) => ticket.id === where.id) ?? null,
          save: async (_entity: any, value: any) => ticketRepo.save(value),
        }),
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

  it("rejects invalid ticket status filters before running archive work", async () => {
    let archiveQueried = false;
    const service = new TicketsService(
      {
        createQueryBuilder: () => {
          archiveQueried = true;
          throw new Error("archive should not run");
        },
      } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "s1",
          userId: "requester",
        }),
      } as any,
      {} as any,
      {} as any,
      settingsServiceMock as any,
    );

    await assert.rejects(
      () => service.listPlatformTickets("Bearer token", "unknown"),
      BadRequestException,
    );
    assert.equal(archiveQueried, false);
  });

  it("rejects attachment boundary violations before creating tickets", async () => {
    let ticketSaved = false;
    const service = new TicketsService(
      {
        create: (value: any) => value,
        save: async () => {
          ticketSaved = true;
        },
      } as any,
      { find: async () => [] } as any,
      {
        findOne: async ({ where }: any) =>
          where.userId === "requester" && where.organizationId === "org-1"
            ? {
                organizationId: "org-1",
                roleId: "member-role",
                status: "active",
                userId: "requester",
              }
            : null,
      } as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "s1",
          userId: "requester",
        }),
      } as any,
      {} as any,
      {} as any,
      settingsServiceMock as any,
    );
    const validAttachment = {
      name: "shot.png",
      size: 1,
      type: "image",
      url: "/api/admin/files/shot.png",
    };

    await assert.rejects(
      () =>
        service.createOrganizationTicket("Bearer token", "org-1", {
          attachments: Array.from({ length: 7 }, () => validAttachment),
          body: "body",
          subject: "subject",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.createOrganizationTicket("Bearer token", "org-1", {
          attachments: [{ ...validAttachment, size: -1 }],
          body: "body",
          subject: "subject",
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.createOrganizationTicket("Bearer token", "org-1", {
          attachments: [{ ...validAttachment, size: 2 * 1024 * 1024 + 1 }],
          body: "body",
          subject: "subject",
        }),
      BadRequestException,
    );
    assert.equal(ticketSaved, false);
  });

  it("closes a ticket under the latest locked state", async () => {
    const ticket = {
      archivedAt: null,
      assigneeUserId: null,
      handlerClosedAt: new Date("2026-07-01T00:00:00Z"),
      id: "ticket-1",
      lastMessageAt: new Date("2026-07-01T00:00:00Z"),
      organizationId: "org-1",
      participantUserIds: [],
      requesterClosedAt: null,
      requesterUserId: "requester",
      scope: "organization",
      status: "closed",
      subject: "Need help",
    };
    const savedTickets: any[] = [];
    const publishSourceCalls: any[] = [];
    const service = new TicketsService(
      {
        manager: {
          transaction: async (work: any) =>
            work({
              findOne: async () => ticket,
              save: async (_entity: any, value: any) => {
                savedTickets.push({ ...value });
                return value;
              },
            }),
        },
      } as any,
      { find: async () => [] } as any,
      {
        findOne: async ({ where }: any) =>
          where.userId === "requester" && where.organizationId === "org-1"
            ? {
                organizationId: "org-1",
                roleId: "member-role",
                status: "active",
                userId: "requester",
              }
            : null,
      } as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "s1",
          userId: "requester",
        }),
      } as any,
      {
        isParticipant: async () => false,
        publishSourceUpdated: async (...input: any[]) => {
          publishSourceCalls.push(input);
        },
      } as any,
      {} as any,
      settingsServiceMock as any,
    );

    const result = await service.closeTicket("Bearer token", "ticket-1");

    assert.equal(result.status, "archived");
    assert.ok(result.requesterClosedAt instanceof Date);
    assert.deepEqual(savedTickets[0].handlerClosedAt, ticket.handlerClosedAt);
    assert.ok(savedTickets[0].archivedAt instanceof Date);
    assert.equal(publishSourceCalls.length, 1);
  });

  it("does not send messages to archived tickets", async () => {
    let sendMessageCalled = false;
    const archivedTicket = {
      archivedAt: new Date("2026-07-01T00:00:00Z"),
      handlerClosedAt: new Date("2026-07-01T00:00:00Z"),
      id: "ticket-1",
      organizationId: "org-1",
      participantUserIds: [],
      requesterClosedAt: new Date("2026-07-01T00:00:00Z"),
      requesterUserId: "requester",
      scope: "organization",
      status: "archived",
      subject: "Need help",
    };
    const service = new TicketsService(
      {
        findOne: async () => archivedTicket,
      } as any,
      { find: async () => [] } as any,
      {
        findOne: async ({ where }: any) =>
          where.userId === "requester" && where.organizationId === "org-1"
            ? {
                organizationId: "org-1",
                roleId: "member-role",
                status: "active",
                userId: "requester",
              }
            : null,
      } as any,
      {} as any,
      {} as any,
      {
        validateAccessToken: async () => ({
          sessionId: "s1",
          userId: "requester",
        }),
      } as any,
      {
        isParticipant: async () => false,
        sendMessage: async () => {
          sendMessageCalled = true;
        },
      } as any,
      {} as any,
      settingsServiceMock as any,
    );

    await assert.rejects(() =>
      service.sendMessage("Bearer token", "ticket-1", { body: "hello" }),
    );
    assert.equal(sendMessageCalled, false);
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

  it("disables organization-wide ticket receiving when the handling feature is off", async () => {
    const service = new TicketsService(
      {
        find: async () => [],
        findOne: async () => ({
          id: "ticket-1",
          organizationId: "org-1",
          participantUserIds: [],
          requesterUserId: "requester",
          scope: "organization",
          status: "open",
        }),
      } as any,
      { find: async () => [] } as any,
      {
        findOne: async ({ where }: any) =>
          where.userId === "handler" && where.organizationId === "org-1"
            ? {
                organizationId: "org-1",
                roleId: "handler-role",
                status: "active",
                userId: "handler",
              }
            : null,
      } as any,
      {} as any,
      {
        findOne: async ({ where }: any) =>
          where.roleId === "handler-role" &&
          where.permission === ORG_HANDLE_PERMISSION &&
          where.enabled
            ? { id: "rp-1" }
            : null,
      } as any,
      {
        validateAccessToken: async () => ({
          sessionId: "s1",
          userId: "handler",
        }),
      } as any,
      {
        importMessagesIfEmpty: async () => ({ imported: 0 }),
        isParticipant: async () => false,
      } as any,
      {} as any,
      {
        getOrganizationValue: async (_organizationId: string, name: string) =>
          name === ORG_HANDLING_FEATURE ? "false" : "true",
        getPlatformValue: async () => "true",
      } as any,
    );

    await assert.rejects(
      () => service.getTicket("Bearer token", "ticket-1"),
      ForbiddenException,
    );
  });

  it("archives tickets closed by only one side for more than seven days", async () => {
    const calls: any[] = [];
    const queryBuilder = {
      andWhere: (condition: string, parameters?: Record<string, unknown>) => {
        calls.push(["andWhere", condition, parameters]);
        return queryBuilder;
      },
      execute: async () => ({ affected: 1 }),
      set: (value: any) => {
        calls.push(["set", value]);
        return queryBuilder;
      },
      update: () => queryBuilder,
      where: (condition: string, parameters?: Record<string, unknown>) => {
        calls.push(["where", condition, parameters]);
        return queryBuilder;
      },
    };
    const service = new TicketsService(
      {
        createQueryBuilder: () => queryBuilder,
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
    assert.deepEqual(calls[0][0], "set");
    assert.equal(calls[0][1].status, "archived");
    assert.ok(calls[0][1].archivedAt instanceof Date);
    assert.match(
      calls.map((call) => call[1]).join(" "),
      /handler_closed_at <= :threshold/,
    );
    assert.match(
      calls.map((call) => call[1]).join(" "),
      /requester_closed_at <= :threshold/,
    );
  });
});
