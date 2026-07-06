import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BadRequestException } from "@nestjs/common";
import { NotificationsService } from "./notifications.service.js";

describe("NotificationsService", () => {
  it("lets a user send organization-scoped notifications to active co-members", async () => {
    const savedNotifications: any[] = [];
    const published: any[] = [];
    const service = new NotificationsService(
      {
        create: (value: any) => ({
          createdAt: new Date("2026-07-06T00:00:00Z"),
          id: `notification-${savedNotifications.length + 1}`,
          readAt: null,
          dismissedAt: null,
          updatedAt: new Date("2026-07-06T00:00:00Z"),
          ...value,
        }),
        save: async (value: any) => {
          savedNotifications.push(value);
          return value;
        },
      } as any,
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
    assert.equal(savedNotifications.length, 1);
    assert.equal(savedNotifications[0].actorUserId, "sender");
    assert.equal(savedNotifications[0].recipientUserId, "recipient");
    assert.equal(savedNotifications[0].sourceType, "user");
    assert.equal(savedNotifications[0].title, "Notice");
    assert.equal(published.length, 1);
    assert.equal(published[0].userId, "recipient");
  });

  it("rejects organization notifications when a recipient is outside the organization", async () => {
    const service = new NotificationsService(
      {} as any,
      {
        find: async () => [
          { organizationId: "org-1", status: "active", userId: "sender" },
        ],
      } as any,
      {
        validateAccessToken: async () => ({ sessionId: "s1", userId: "sender" }),
      } as any,
      {} as any,
    );

    await assert.rejects(
      () =>
        service.sendFromAuthorization("Bearer token", {
          organizationId: "org-1",
          recipientUserIds: ["outsider"],
          title: "Notice",
        }),
      BadRequestException,
    );
  });
});
