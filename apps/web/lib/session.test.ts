import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Snapshot } from "./admin-api";
import { resolveSession } from "./session";

describe("resolved web sessions", () => {
  it("uses the global account in a platform context", () => {
    const currentUser = {
      permissions: ["page.settings.platform.access:platform"],
      principalType: "platform" as const,
      role: null,
      user: {
        avatarUrl: null,
        createdAt: "2026-07-11T00:00:00.000Z",
        displayName: "Platform Admin",
        email: "admin@example.com",
        emailVerified: true,
        firstName: null,
        id: "account-1",
        imageUrl: null,
        lastName: null,
        mobile: null,
        nickname: null,
        preferredLanguage: "zh-CN",
        status: "active" as const,
        workspaceId: null,
        timeZone: null,
        type: "user" as const,
        updatedAt: "2026-07-11T00:00:00.000Z",
        username: null,
      },
    } as Snapshot["currentUser"];
    const snapshot = { currentUser } as Snapshot;

    const resolved = resolveSession(snapshot);

    assert.equal(resolved.principalType, "platform");
    assert.equal(resolved.user.id, "account-1");
    assert.equal("platformMembership" in resolved, false);
  });
});
