import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  Ticket,
  User,
  UserDepartment,
  UserNotification,
} from "@hermes-swarm/core";
import { NotificationsService } from "../notifications/notifications.service.js";
import { TicketsService } from "../tickets/tickets.service.js";

describe("department dispatch consumers", () => {
  it("routes a department ticket while retaining the source organization authorization check", async () => {
    let routedInput: Record<string, unknown> | undefined;
    const dispatchResolver = {
      resolveTicketAssignment: async () => ({
        cycleDetected: false,
        idempotencyKey: "ticket-create-1",
        maxHops: 8,
        purpose: "ticket_assignment",
        sourceDepartmentId: "dept-source",
        targets: [
          {
            departmentId: "dept-target",
            hop: 1,
            organizationId: "org-target",
            path: ["dept-source", "dept-target"],
            policy: {},
            priority: 10,
            relationId: "relation-1",
            type: "handoff",
          },
        ],
        tenantId: "tenant-1",
        truncated: false,
        visitedDepartmentIds: ["dept-source", "dept-target"],
      }),
    };
    const service = new TicketsService(
      { manager: {} } as never,
      {} as never,
      {
        findOne: async ({ where }: { where: { organizationId: string } }) =>
          where.organizationId === "org-source" ? { id: "membership-1" } : null,
      } as never,
      {} as never,
      {} as never,
      {
        validateAccessToken: async () => ({ tenantId: "tenant-1", userId: "user-1" }),
      } as never,
      {} as never,
      {} as never,
      {
        getOrganizationValue: async () => "true",
        getPlatformValue: async () => "true",
      } as never,
      undefined,
      dispatchResolver as never,
    );
    (service as unknown as {
      createTicketWithFirstMessage: (input: Record<string, unknown>) => Promise<unknown>;
    }).createTicketWithFirstMessage = async (input) => {
      routedInput = input;
      return input;
    };

    await service.createOrganizationTicket("Bearer token", "org-source", {
      body: "Help",
      departmentId: "dept-source",
      idempotencyKey: "ticket-create-1",
      subject: "Route me",
    });

    assert.equal(routedInput?.departmentId, "dept-target");
    assert.equal(routedInput?.organizationId, "org-target");
    assert.equal(routedInput?.scope, "department");
  });

  it("selects notification recipients only from existing active memberships", async () => {
    const saved: Array<Record<string, unknown>> = [];
    const notificationsRepository = {
      create: (input: Record<string, unknown>) => ({
        createdAt: new Date(),
        dismissedAt: null,
        id: `notification-${saved.length + 1}`,
        readAt: null,
        updatedAt: new Date(),
        ...input,
      }),
      save: async (items: Array<Record<string, unknown>>) => {
        saved.push(...items);
        return items;
      },
    };
    const tenantContext = {
      current: () => ({ tenantId: "tenant-1" }),
      repository: (target: unknown) => {
        if (target === UserDepartment) {
          return {
            find: async () => [
              {
                departmentId: "dept-target",
                membership: { status: "active", userId: "user-active" },
              },
              {
                departmentId: "dept-target",
                membership: { status: "disabled", userId: "user-disabled" },
              },
            ],
          };
        }
        if (target === User) {
          return { find: async () => [{ id: "user-active" }] };
        }
        if (target === UserNotification) return notificationsRepository;
        return { find: async () => [] };
      },
    };
    const dispatchResolver = {
      resolveNotificationTargets: async () => ({
        cycleDetected: false,
        idempotencyKey: "event-1",
        maxHops: 8,
        purpose: "notification_targets",
        sourceDepartmentId: "dept-source",
        targets: [
          {
            departmentId: "dept-target",
            hop: 1,
            organizationId: "org-target",
            path: ["dept-source", "dept-target"],
            policy: {},
            priority: 10,
            relationId: "relation-1",
            type: "collaboration",
          },
        ],
        tenantId: "tenant-1",
        truncated: false,
        visitedDepartmentIds: ["dept-source", "dept-target"],
      }),
    };
    const service = new NotificationsService(
      tenantContext as never,
      {} as never,
      { publishToUser: async () => undefined } as never,
      dispatchResolver as never,
    );

    const result = await service.createForDepartmentRoute({
      idempotencyKey: "event-1",
      sourceDepartmentId: "dept-source",
      sourceId: "ticket-1",
      sourceType: "ticket",
      title: "Ticket routed",
    });

    assert.equal(result.notifications.length, 1);
    assert.equal(saved[0]?.recipientUserId, "user-active");
    assert.equal(saved[0]?.departmentId, "dept-target");
    assert.equal(saved[0]?.organizationId, "org-target");
  });

  it("delegates ticket escalation without changing ticket access", async () => {
    let resolverInput: Record<string, unknown> | undefined;
    const ticketRepository = {
      findOne: async () =>
        ({ departmentId: "dept-source", id: "ticket-1", tenantId: "tenant-1" }) as Ticket,
      manager: {},
    };
    const dispatchResolver = {
      resolveEscalationRoute: async (input: Record<string, unknown>) => {
        resolverInput = input;
        return { targets: [{ departmentId: "dept-escalated" }] };
      },
    };
    const service = new TicketsService(
      ticketRepository as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      undefined,
      dispatchResolver as never,
    );

    const result = await service.resolveTicketEscalationRoute(
      "tenant-1",
      "ticket-1",
      "ticket-1:escalate",
      5,
    );

    assert.deepEqual(result, { targets: [{ departmentId: "dept-escalated" }] });
    assert.deepEqual(resolverInput, {
      idempotencyKey: "ticket-1:escalate",
      maxHops: 5,
      sourceDepartmentId: "dept-source",
      tenantId: "tenant-1",
    });
  });
});
