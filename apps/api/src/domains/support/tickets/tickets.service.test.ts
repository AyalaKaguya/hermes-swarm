import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import {
  Organization,
  RolePermission,
  Ticket,
  UserOrganization,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { TicketsService } from "./tickets.service.js";

describe("TicketsService organization-source access", () => {
  it("requires submit permission and an active source organization membership", async () => {
    const state = createState();
    const created = await state.service.createTicket("Bearer requester", {
      body: "Need help",
      sourceOrganizationId: "child",
      subject: "Access issue",
    });
    assert.equal(created.sourceOrganizationId, "child");
    assert.equal(state.tickets[0]?.tenantId, "tenant-a");

    state.memberships.splice(0, state.memberships.length);
    await assert.rejects(
      state.service.createTicket("Bearer requester", {
        body: "Need help",
        sourceOrganizationId: "child",
        subject: "No membership",
      }),
      ForbiddenException,
    );
  });

  it("lets requesters read their own ticket without handler access", async () => {
    const state = createState();
    const items = await state.service.listTickets("Bearer requester");
    assert.deepEqual(items.map((item) => item.id), ["ticket-child"]);
  });

  it("lets organization handlers cover their exact organization", async () => {
    const state = createState({ sessionUserId: "handler" });
    state.memberships.push({ id: "membership-handler", organizationId: "child", status: "active", tenantId: "tenant-a", userId: "handler" });
    state.organizationAssignments.push({ membershipId: "membership-handler", organizationId: "child", roleId: "handler-role", tenantId: "tenant-a" });
    state.permissions.push({ enabled: true, permission: "ticket.conversation.handle:organization", roleId: "handler-role", tenantId: "tenant-a" });
    const items = await state.service.listTickets("Bearer handler");
    assert.deepEqual(items.map((item) => item.id), ["ticket-child"]);
  });

  it("does not let sibling organization handlers read the ticket", async () => {
    const state = createState({ sessionUserId: "handler" });
    state.memberships.push({ id: "membership-handler", organizationId: "sibling", status: "active", tenantId: "tenant-a", userId: "handler" });
    state.organizationAssignments.push({ membershipId: "membership-handler", organizationId: "sibling", roleId: "handler-role", tenantId: "tenant-a" });
    state.permissions.push({ enabled: true, permission: "ticket.conversation.handle:organization", roleId: "handler-role", tenantId: "tenant-a" });
    assert.deepEqual(await state.service.listTickets("Bearer handler"), []);
  });
});

function createState(options: { sessionUserId?: string } = {}) {
  const tickets: Array<Record<string, any>> = [{
    archivedAt: null,
    assigneeUserId: null,
    conversationId: "conversation-child",
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    handlerClosedAt: null,
    id: "ticket-child",
    lastMessageAt: null,
    participantUserIds: ["requester"],
    requesterClosedAt: null,
    requesterUserId: "requester",
    sourceOrganization: { id: "child", name: "Child", slug: "child" },
    sourceOrganizationId: "child",
    status: "open",
    subject: "Existing ticket",
    tenantId: "tenant-a",
    updatedAt: new Date("2026-07-15T00:00:00.000Z"),
  }];
  const memberships: Array<Record<string, any>> = [{ id: "membership-requester", organizationId: "child", status: "active", tenantId: "tenant-a", userId: "requester" }];
  const organizationAssignments: Array<Record<string, any>> = [{ membershipId: "membership-requester", organizationId: "child", roleId: "submit-role", tenantId: "tenant-a" }];
  const permissions: Array<Record<string, any>> = [{ enabled: true, permission: "ticket.conversation.submit:organization", roleId: "submit-role", tenantId: "tenant-a" }];
  const organizations = [{ id: "child", status: "active", tenantId: "tenant-a" }];
  const repositories = new Map<any, any>([
    [Ticket, {
      find: async () => tickets,
      findOne: async ({ where }: any) => tickets.find((item) => item.id === where.id && item.tenantId === where.tenantId) ?? null,
      save: async (value: any) => value,
    }],
    [UserOrganization, {
      find: async ({ where }: any) => memberships.filter((item) => item.userId === where.userId && item.tenantId === where.tenantId && item.status === where.status),
      findOne: async ({ where }: any) => memberships.find((item) => item.userId === where.userId && item.organizationId === where.organizationId && item.tenantId === where.tenantId && item.status === where.status) ?? null,
    }],
    [Organization, { findOne: async ({ where }: any) => organizations.find((item) => item.id === where.id && item.status === where.status && item.tenantId === where.tenantId) ?? null }],
    [UserOrganizationRole, { findOne: async ({ where }: any) => organizationAssignments.find((item) => item.membershipId === where.membershipId && item.organizationId === where.organizationId && item.tenantId === where.tenantId) ?? null }],
    [RolePermission, { findOne: async ({ where }: any) => permissions.find((item) => item.permission === where.permission && item.tenantId === where.tenantId && readInValues(where.roleId).includes(item.roleId)) ?? null }],
  ]);
  const manager = {
    create: (_target: unknown, value: any) => ({ id: `ticket-${tickets.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...value }),
    query: async () => [{ id: "child" }, { id: "root" }],
    save: async (_target: unknown, value: any) => { if (!tickets.includes(value)) tickets.push(value); return value; },
    transaction: async (work: (manager: unknown) => unknown) => work(manager),
  };
  const service = new TicketsService(
    { validateAccessToken: async () => ({ principalType: "tenant", tenantId: "tenant-a", userId: options.sessionUserId ?? "requester" }) } as never,
    {
      createMessageInTransaction: async () => ({
        conversation: { id: "conversation-new", sourceId: "ticket-new", sourceType: "ticket", tenantId: "tenant-a" },
        message: { attachments: [], body: "Need help", createdAt: new Date(), id: "message-new" },
      }),
      isParticipant: async () => false,
      publishMessageAfterCommit: async () => undefined,
    } as never,
    { current: () => ({ manager, tenantId: "tenant-a" }), repository: (target: unknown) => repositories.get(target) } as never,
  );
  return { memberships, organizationAssignments, permissions, service, tickets };
}

function readInValues(value: any): string[] {
  if (typeof value === "string") return [value];
  return value?._value ?? value?.value ?? [];
}
