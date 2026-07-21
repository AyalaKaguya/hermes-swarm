import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import {
  RolePermission,
  Ticket,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { TicketsService } from "./tickets.service.js";

describe("TicketsService workspace access", () => {
  it("requires workspace submit permission", async () => {
    const state = createState();
    const created = await state.service.createTicket("Bearer requester", {
      body: "Need help",
      subject: "Access issue",
    });
    assert.equal(created.workspaceId, "workspace-a");
    assert.equal(state.tickets.at(-1)?.requesterUserId, "requester");

    state.permissions.splice(0, state.permissions.length);
    await assert.rejects(
      state.service.createTicket("Bearer requester", {
        body: "Need help",
        subject: "No permission",
      }),
      ForbiddenException,
    );
  });

  it("lets requesters read their own ticket without handler access", async () => {
    const state = createState();
    const items = await state.service.listTickets("Bearer requester");
    assert.deepEqual(items.map((item) => item.id), ["ticket-existing"]);
  });

  it("lets an authorized handler read all workspace tickets", async () => {
    const state = createState({ sessionUserId: "handler" });
    state.assignments.push({
      roleId: "handler-role",
      accountId: "handler",
      workspaceId: "workspace-a",
      status: "active",
    });
    state.permissions.push({
      enabled: true,
      permissionRecord: { code: "ticket.conversation.handle:workspace" },
      roleId: "handler-role",
    });

    const items = await state.service.listTickets("Bearer handler");
    assert.deepEqual(items.map((item) => item.id), ["ticket-existing"]);
    assert.deepEqual(
      await state.service.handlingCapability("Bearer handler"),
      { canHandle: true },
    );
  });

  it("hides unrelated tickets from members without handler permission", async () => {
    const state = createState({ sessionUserId: "member" });
    state.assignments.push({
      roleId: "member-role",
      accountId: "member",
      workspaceId: "workspace-a",
      status: "active",
    });
    assert.deepEqual(await state.service.listTickets("Bearer member"), []);
  });
});

function createState(options: { sessionUserId?: string } = {}) {
  const tickets: Array<Record<string, any>> = [
    {
      archivedAt: null,
      assigneeUserId: null,
      conversationId: "conversation-existing",
      createdAt: new Date("2026-07-15T00:00:00.000Z"),
      handlerClosedAt: null,
      id: "ticket-existing",
      lastMessageAt: null,
      participantUserIds: ["requester"],
      requesterClosedAt: null,
      requesterUserId: "requester",
      status: "open",
      subject: "Existing ticket",
      workspaceId: "workspace-a",
      updatedAt: new Date("2026-07-15T00:00:00.000Z"),
    },
  ];
  const assignments: Array<Record<string, any>> = [
    {
      roleId: "submit-role",
      accountId: "requester",
      workspaceId: "workspace-a",
      status: "active",
    },
  ];
  const permissions: Array<Record<string, any>> = [
    {
      enabled: true,
      permissionRecord: { code: "ticket.conversation.submit:workspace" },
      roleId: "submit-role",
    },
  ];
  const repositories = new Map<any, any>([
    [
      Ticket,
      {
        find: async () => tickets,
        findOne: async ({ where }: any) =>
          tickets.find(
            (item) =>
              item.id === where.id && item.workspaceId === where.workspaceId,
          ) ?? null,
        save: async (value: any) => value,
      },
    ],
    [
      WorkspaceMembership,
      {
        findOne: async ({ where }: any) =>
          assignments.find(
            (item) =>
              item.accountId === where.accountId &&
              item.status === where.status &&
              item.workspaceId === where.workspaceId,
          ) ?? null,
      },
    ],
    [
      RolePermission,
      {
        findOne: async ({ where }: any) =>
          permissions.find(
            (item) =>
              item.enabled === where.enabled &&
              item.permissionRecord.code === where.permissionRecord.code &&
              item.roleId === where.roleId,
          ) ?? null,
      },
    ],
  ]);
  const manager = {
    create: (_target: unknown, value: any) => ({
      id: `ticket-${tickets.length + 1}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...value,
    }),
    save: async (_target: unknown, value: any) => {
      if (!tickets.includes(value)) tickets.push(value);
      return value;
    },
    transaction: async (work: (manager: unknown) => unknown) => work(manager),
  };
  const service = new TicketsService(
    {
      validateAccessToken: async () => ({
        principalType: "workspace",
        workspaceId: "workspace-a",
        userId: options.sessionUserId ?? "requester",
      }),
    } as never,
    {
      createMessageInTransaction: async () => ({
        conversation: {
          id: "conversation-new",
          sourceId: "ticket-new",
          sourceType: "ticket",
          workspaceId: "workspace-a",
        },
        message: {
          attachments: [],
          authorUserId: "requester",
          body: "Need help",
          conversationId: "conversation-new",
          createdAt: new Date(),
          id: "message-new",
          kind: "user",
          metadata: null,
          updatedAt: new Date(),
        },
      }),
      isParticipant: async () => false,
      publishMessageAfterCommit: async () => undefined,
    } as never,
    {
      current: () => ({ manager, workspaceId: "workspace-a" }),
      repository: (target: unknown) => repositories.get(target),
    } as never,
  );
  return { assignments, permissions, service, tickets };
}
