import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { User, UserNotification, UserOrganization } from "@hermes-swarm/core";
import { NotificationsService } from "./notifications.service.js";

describe("NotificationsService", () => {
  it("normalizes notification list query limits before querying", async () => {
    const observedTakes: number[] = [];
    const observedTenantIds: string[] = [];
    const service = createNotificationsService(
      {
        find: async (options: any) => {
          observedTakes.push(options.take);
          observedTenantIds.push(options.where.tenantId);
          return [];
        },
      } as any,
      {} as any,
      {
        validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
      } as any,
      {} as any,
    );

    await service.listForAuthorization("Bearer token");
    await service.listForAuthorization("Bearer token", { take: 0 });
    await service.listForAuthorization("Bearer token", { take: 999 });

    assert.deepEqual(observedTakes, [50, 1, 100]);
    assert.deepEqual(observedTenantIds, ["tenant-1", "tenant-1", "tenant-1"]);
  });

  it("rejects invalid notification list filters before querying", async () => {
    let queried = false;
    const service = createNotificationsService(
      {
        find: async () => {
          queried = true;
          return [];
        },
      } as any,
      {} as any,
      {
        validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
      } as any,
      {} as any,
    );

    await assert.rejects(
      () =>
        service.listForAuthorization("Bearer token", {
          take: Number.NaN,
        } as any),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.listForAuthorization("Bearer token", {
          status: "archived",
        } as any),
      BadRequestException,
    );
    assert.equal(queried, false);
  });

  it("lets a user send organization-scoped notifications to active co-members", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const published: any[] = [];
    const service = createNotificationsService(
      notificationRepository.repository,
      {
        find: async () => [
          { organizationId: "org-1", status: "active", userId: "sender" },
          { organizationId: "org-1", status: "active", userId: "recipient" },
        ],
      } as any,
      {
        validateAccessToken: async () => ({ sessionId: "s1", userId: "sender" }),
      } as any,
      {
        publishToUser: (userId: string, event: unknown) => {
          published.push({ event, userId });
        },
      } as any,
    );

    const result = await service.sendFromAuthorization("Bearer token", {
      body: "hello",
      kind: "success",
      organizationId: "org-1",
      recipientUserIds: ["recipient", "recipient"],
      title: " Notice ",
    });

    assert.equal(result.length, 1);
    assert.equal(notificationRepository.saved.length, 1);
    assert.equal(notificationRepository.saved[0].actorUserId, "sender");
    assert.equal(notificationRepository.saved[0].recipientUserId, "recipient");
    assert.equal(notificationRepository.saved[0].sourceType, "user");
    assert.equal(notificationRepository.saved[0].title, "Notice");
    assert.equal(published.length, 1);
    assert.equal(published[0].userId, "recipient");
  });

  it("uses the current tenant transaction before publishing realtime events", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const published: any[] = [];
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {} as any,
      {
        publishToUser: (userId: string, event: unknown) => {
          published.push({ event, userId });
        },
      } as any,
    );

    const result = await service.createForUsers(["user-1", "user-2", "user-1"], {
      title: "Notice",
    });

    assert.equal(result.length, 2);
    assert.equal(notificationRepository.transactionCount, 0);
    assert.deepEqual(
      notificationRepository.saved.map((item) => item.recipientUserId),
      ["user-1", "user-2"],
    );
    assert.deepEqual(
      published.map((item) => item.userId),
      ["user-1", "user-2"],
    );
  });

  it("does not publish realtime events when bulk notification persistence fails", async () => {
    const notificationRepository = createNotificationRepositoryHarness({
      save: async () => {
        throw new Error("database unavailable");
      },
    });
    const published: any[] = [];
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {} as any,
      {
        publishToUser: (userId: string, event: unknown) => {
          published.push({ event, userId });
        },
      } as any,
    );

    await assert.rejects(
      () => service.createForUsers(["user-1", "user-2"], { title: "Notice" }),
      /database unavailable/,
    );

    assert.deepEqual(notificationRepository.saved, []);
    assert.deepEqual(published, []);
  });

  it("rejects malformed bulk notification recipients before opening a transaction", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {} as any,
      {} as any,
    );

    await assert.rejects(
      () => service.createForUsers(["user-1", " "] as any, { title: "Notice" }),
      BadRequestException,
    );
    await assert.rejects(
      () => service.createForUsers(null as any, { title: "Notice" }),
      BadRequestException,
    );
    assert.equal(notificationRepository.transactionCount, 0);
  });

  it("rejects invalid notification kind before persistence", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {
        validateAccessToken: async () => ({ sessionId: "s1", userId: "sender" }),
      } as any,
      {} as any,
    );

    await assert.rejects(
      () =>
        service.sendFromAuthorization("Bearer token", {
          kind: "critical",
          recipientUserIds: ["recipient"],
          title: "Notice",
        }),
      BadRequestException,
    );
    assert.equal(notificationRepository.transactionCount, 0);
  });

  it("rejects notification fields that exceed persisted limits", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {} as any,
      {} as any,
    );

    await assert.rejects(
      () =>
        service.createForUser({
          recipientUserId: "recipient",
          title: "x".repeat(241),
        }),
      BadRequestException,
    );
    await assert.rejects(
      () =>
        service.createForUser({
          recipientUserId: "recipient",
          sourceType: "x".repeat(81),
          title: "Notice",
        }),
      BadRequestException,
    );
    assert.equal(notificationRepository.saved.length, 0);
  });

  it("routes notifications by tenant recipient without organization destinations", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {
        validateAccessToken: async () => ({ sessionId: "s1", userId: "sender" }),
      } as any,
      {} as any,
    );

    const result = await service.sendFromAuthorization("Bearer token", {
      recipientUserIds: ["recipient"],
      title: "Notice",
    });
    assert.equal(result.length, 1);
    assert.equal(notificationRepository.saved[0]?.recipientUserId, "recipient");
  });

  it("rejects recipients that are outside the active tenant", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {} as any,
      {} as any,
      { tenantId: "tenant-1", userIds: ["inside"] },
    );

    await assert.rejects(
      () =>
        service.createForUser({
          recipientUserId: "other-tenant-user",
          title: "Notice",
        }),
      BadRequestException,
    );
    assert.equal(notificationRepository.saved.length, 0);
  });

  it("keeps saved notifications when realtime publish fails", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {} as any,
      {
        publishToUser: () => {
          throw new Error("socket write failed");
        },
      } as any,
    );

    const result = await service.createForUser({
      recipientUserId: "recipient",
      title: "Notice",
    });

    assert.equal(result.id, "notification-1");
    assert.equal(notificationRepository.saved.length, 1);
  });

  it("publishes single notifications to the normalized recipient id", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const published: any[] = [];
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {} as any,
      {
        publishToUser: (userId: string, event: unknown) => {
          published.push({ event, userId });
        },
      } as any,
    );

    await service.createForUser({
      recipientUserId: " user-1 ",
      title: "Notice",
    });

    assert.equal(notificationRepository.saved[0].recipientUserId, "user-1");
    assert.equal(published[0].userId, "user-1");
  });

  it("does not mark dismissed notifications as read", async () => {
    let updateWhere: unknown;
    const service = createNotificationsService(
      {
        update: async (where: unknown) => {
          updateWhere = where;
          return { affected: 1 };
        },
      } as any,
      {} as any,
      {
        validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
      } as any,
      {} as any,
    );

    await service.markAllRead("Bearer token");

    assert.deepEqual(Object.keys(updateWhere as Record<string, unknown>).sort(), [
      "dismissedAt",
      "recipientUserId",
      "status",
      "tenantId",
    ]);
  });

  it("treats dismissed single notifications as not found", async () => {
    const service = createNotificationsService(
      {
        findOne: async () => null,
      } as any,
      {} as any,
      {
        validateAccessToken: async () => ({ sessionId: "s1", userId: "user-1" }),
      } as any,
      {} as any,
    );

    await assert.rejects(
      () => service.markRead("Bearer token", "notification-1"),
      NotFoundException,
    );
    await assert.rejects(
      () => service.dismiss("Bearer token", "notification-1"),
      NotFoundException,
    );
  });
});

function createNotificationsService(
  notificationRepository: any,
  membershipRepository: any,
  authSessionService: any,
  realtimeEventBus: any,
  options: { tenantId?: string; userIds?: string[] } = {},
) {
  const tenantId = options.tenantId ?? "tenant-1";
  const userRepository = {
    find: async ({ where }: any) => {
      const requested = where.id?._value ?? where.id?.value ?? [];
      const allowed = options.userIds ?? requested;
      return requested
        .filter((id: string) => allowed.includes(id))
        .map((id: string) => ({ id, status: "active", tenantId }));
    },
  };
  const tenantContext = {
    current: () => ({ tenantId }),
    repository: (target: unknown) => {
      if (target === UserNotification) return notificationRepository;
      if (target === UserOrganization) return membershipRepository;
      if (target === User) return userRepository;
      throw new Error("Unexpected repository");
    },
  };
  const sessionService = authSessionService?.validateAccessToken
    ? {
        ...authSessionService,
        validateAccessToken: async (...args: any[]) => {
          const session = await authSessionService.validateAccessToken(...args);
          return { tenantId: session.tenantId ?? tenantId, ...session };
        },
      }
    : authSessionService;
  const eventBus = realtimeEventBus?.publishToUser
    ? {
        ...realtimeEventBus,
        publishToUser: (_tenantId: string, userId: string, event: unknown) =>
          realtimeEventBus.publishToUser(userId, event),
      }
    : realtimeEventBus;
  return new NotificationsService(
    tenantContext as any,
    sessionService,
    eventBus,
  );
}

function createNotificationRepositoryHarness(overrides: Record<string, any> = {}) {
  const saved: any[] = [];
  const state = {
    saved,
    transactionCount: 0,
  };
  const repository: any = {
    create: (value: any) => ({
      createdAt: new Date("2026-07-06T00:00:00Z"),
      dismissedAt: null,
      id: `notification-${saved.length + 1}`,
      readAt: null,
      updatedAt: new Date("2026-07-06T00:00:00Z"),
      ...value,
    }),
    save: async (value: any) => {
      const values = Array.isArray(value) ? value : [value];
      const withIds = values.map((item) => ({
        ...item,
        id: item.id ?? `notification-${saved.length + 1}`,
      }));
      saved.push(...withIds);
      return Array.isArray(value) ? withIds : withIds[0];
    },
    ...overrides,
  };
  repository.manager = {
    transaction: async (callback: any) => {
      state.transactionCount += 1;
      return callback({
        getRepository: () => repository,
      });
    },
  };
  return {
    get transactionCount() {
      return state.transactionCount;
    },
    repository,
    saved,
  };
}
