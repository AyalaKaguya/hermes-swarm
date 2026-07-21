import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Account, UserNotification } from "@hermes-swarm/core";
import { NotificationsService } from "./notifications.service.js";

describe("NotificationsService", () => {
  it("normalizes notification list query limits before querying", async () => {
    const observedTakes: number[] = [];
    const observedWorkspaceIds: string[] = [];
    const service = createNotificationsService(
      {
        find: async (options: any) => {
          observedTakes.push(options.take);
          observedWorkspaceIds.push(options.where.workspaceId);
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
    assert.deepEqual(observedWorkspaceIds, ["workspace-1", "workspace-1", "workspace-1"]);
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

  it("lets a member send notifications to active workspace members", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const published: any[] = [];
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
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

  it("uses the current workspace transaction before publishing realtime events", async () => {
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

  it("routes notifications directly by workspace recipient", async () => {
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

  it("rejects recipients that are outside the active workspace", async () => {
    const notificationRepository = createNotificationRepositoryHarness();
    const service = createNotificationsService(
      notificationRepository.repository,
      {} as any,
      {} as any,
      {} as any,
      { workspaceId: "workspace-1", userIds: ["inside"] },
    );

    await assert.rejects(
      () =>
        service.createForUser({
          recipientUserId: "other-workspace-user",
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
      "workspaceId",
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
  _legacyRepository: any,
  authSessionService: any,
  realtimeEventBus: any,
  options: { workspaceId?: string; userIds?: string[] } = {},
) {
  const workspaceId = options.workspaceId ?? "workspace-1";
  const userRepository = {
    find: async ({ where }: any) => {
      const requested = where.id?._value ?? where.id?.value ?? [];
      const allowed = options.userIds ?? requested;
      return requested
        .filter((id: string) => allowed.includes(id))
        .map((id: string) => ({ id, status: "active", workspaceId }));
    },
  };
  const workspaceContext = {
    current: () => ({ workspaceId }),
    repository: (target: unknown) => {
      if (target === UserNotification) return notificationRepository;
      if (target === Account) return userRepository;
      throw new Error("Unexpected repository");
    },
  };
  const sessionService = authSessionService?.validateAccessToken
    ? {
        ...authSessionService,
        validateAccessToken: async (...args: any[]) => {
          const session = await authSessionService.validateAccessToken(...args);
          return { workspaceId: session.workspaceId ?? workspaceId, ...session };
        },
      }
    : authSessionService;
  const eventBus = realtimeEventBus?.publishToUser
    ? {
        ...realtimeEventBus,
        publishToUser: (_workspaceId: string, userId: string, event: unknown) =>
          realtimeEventBus.publishToUser(userId, event),
      }
    : realtimeEventBus;
  return new NotificationsService(
    workspaceContext as any,
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
