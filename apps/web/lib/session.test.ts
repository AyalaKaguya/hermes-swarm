import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Snapshot } from "./admin-api";
import { resolveSession } from "./session";

describe("resolved web sessions", () => {
  it("keeps platform identity separate from tenant memberships", () => {
    const currentUser = {
      memberships: [],
      organization: null,
      permissions: ["page.settings.platform.access:platform"],
      platformUser: {
        displayName: "Platform Admin",
        email: "admin@example.com",
        id: "platform-user-1",
        roles: [],
        status: "active" as const,
      },
      principalType: "platform" as const,
      role: null,
      user: {
        avatarUrl: null,
        createdAt: "2026-07-11T00:00:00.000Z",
        displayName: "Platform Admin",
        email: "admin@example.com",
        emailVerified: true,
        firstName: null,
        id: "platform-user-1",
        imageUrl: null,
        lastName: null,
        mobile: null,
        nickname: null,
        preferredLanguage: "zh-CN",
        status: "active" as const,
        tenantId: null,
        timeZone: null,
        type: "user" as const,
        updatedAt: "2026-07-11T00:00:00.000Z",
        username: null,
      },
    } as Snapshot["currentUser"];
    const snapshot = { currentUser } as Snapshot;

    const resolved = resolveSession(snapshot);

    assert.equal(resolved.principalType, "platform");
    assert.equal(resolved.platformUser?.id, "platform-user-1");
    assert.deepEqual(resolved.memberships, []);
    assert.equal("platformMembership" in resolved, false);
  });
});
