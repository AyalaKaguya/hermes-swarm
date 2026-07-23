import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AuthSessionStoreService } from "./auth-session-store.service.js";
import type { AuthSessionRecord } from "./auth-session.types.js";

describe("AuthSessionStoreService", () => {
  it("keeps platform and workspace session records in separate namespaces", async () => {
    const client = createRedisClient();
    const store = createStore(client);
    const workspaceRecord = createSessionRecord({ workspaceId: "workspace-1" });
    const platformRecord = createSessionRecord({ workspaceId: null });

    await store.saveSession(workspaceRecord, 120);
    await store.saveSession(platformRecord, 120);

    assert.deepEqual(
      await store.getSessionRecord("workspace-1", workspaceRecord.sessionId),
      workspaceRecord,
    );
    assert.deepEqual(
      await store.getSessionRecord(null, platformRecord.sessionId),
      platformRecord,
    );
    assert.equal(client.expirations.get("auth:workspace-1:session:session-1"), 120);
    assert.equal(client.expirations.get("auth:platform:session:session-1"), 120);
  });

  it("consumes context selections and realtime tickets only once", async () => {
    const client = createRedisClient();
    const store = createStore(client);

    await store.saveContextSelection(
      "selection-hash",
      {
        accountId: "account-1",
        contextMembershipIds: ["membership-1"],
        credentialVersion: 3,
        expiresAt: "2026-07-24T00:00:00.000Z",
      },
      300,
    );
    assert.match(
      (await store.consumeContextSelection("selection-hash")) ?? "",
      /account-1/,
    );
    assert.equal(await store.consumeContextSelection("selection-hash"), null);

    await store.createRealtimeTicket(
      "ticket-hash",
      { sessionId: "session-1", userId: "account-1", workspaceId: "workspace-1" },
      30,
    );
    assert.match(
      (await store.consumeRealtimeTicket("ticket-hash")) ?? "",
      /workspace-1/,
    );
    assert.equal(await store.consumeRealtimeTicket("ticket-hash"), null);
  });

  it("indexes sessions by their account and membership for revocation", async () => {
    const client = createRedisClient();
    const store = createStore(client);

    await store.addUserSession(
      "workspace-1",
      "account-1",
      "session-1",
      "workspace",
      "membership-1",
      120,
    );

    assert.deepEqual(
      await store.listUserSessionIds("workspace-1", "account-1"),
      ["session-1"],
    );
    assert.deepEqual(await store.listAccountSessionEntries("account-1"), [
      "workspace-1:session-1",
    ]);
    assert.deepEqual(
      await store.listMembershipSessionEntries("workspace", "membership-1"),
      ["workspace-1:session-1"],
    );

    await store.removeUserSessionIds("workspace-1", "account-1", ["session-1"]);
    assert.deepEqual(await store.listUserSessionIds("workspace-1", "account-1"), []);
  });

  it("releases a refresh lock only when the caller owns it", async () => {
    const client = createRedisClient();
    const store = createStore(client);

    assert.equal(await store.acquireRefreshLock("token-hash", "owner-1", 10), true);
    assert.equal(await store.acquireRefreshLock("token-hash", "owner-2", 10), false);
    await store.releaseRefreshLock("token-hash", "owner-2");
    assert.equal(await store.acquireRefreshLock("token-hash", "owner-2", 10), false);
    await store.releaseRefreshLock("token-hash", "owner-1");
    assert.equal(await store.acquireRefreshLock("token-hash", "owner-2", 10), true);
  });
});

function createStore(client: ReturnType<typeof createRedisClient>) {
  return new AuthSessionStoreService({ getClient: async () => client } as never);
}

function createSessionRecord(
  input: Pick<AuthSessionRecord, "workspaceId">,
): AuthSessionRecord {
  return {
    accountId: "account-1",
    browser: "Chrome",
    credentialVersion: 1,
    createdAt: "2026-07-23T00:00:00.000Z",
    deviceLabel: "Desktop",
    expiresAt: "2026-08-23T00:00:00.000Z",
    ipAddress: null,
    lastSeenAt: "2026-07-23T00:00:00.000Z",
    membershipId: input.workspaceId ? "membership-1" : "platform-membership-1",
    os: "Windows",
    principalType: input.workspaceId ? "workspace" : "platform",
    refreshTokenHash: "refresh-token-hash",
    revokedAt: null,
    sessionId: "session-1",
    userAgent: null,
    userId: "account-1",
    workspaceId: input.workspaceId,
  };
}

function createRedisClient() {
  const values = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  const expirations = new Map<string, number>();

  return {
    expirations,
    async del(key: string) {
      return values.delete(key) ? 1 : 0;
    },
    async eval(_script: string, input: { arguments: string[]; keys: string[] }) {
      const [key] = input.keys;
      const [owner] = input.arguments;
      if (key && owner && values.get(key) === owner) {
        values.delete(key);
        return 1;
      }
      return 0;
    },
    async expire(key: string, ttlSeconds: number) {
      expirations.set(key, ttlSeconds);
      return 1;
    },
    async get(key: string) {
      return values.get(key) ?? null;
    },
    async getDel(key: string) {
      const value = values.get(key) ?? null;
      values.delete(key);
      return value;
    },
    async sAdd(key: string, member: string) {
      const entries = sets.get(key) ?? new Set<string>();
      entries.add(member);
      sets.set(key, entries);
      return 1;
    },
    async sMembers(key: string) {
      return [...(sets.get(key) ?? [])];
    },
    async sRem(key: string, members: string | string[]) {
      const entries = sets.get(key);
      for (const member of typeof members === "string" ? [members] : members) {
        entries?.delete(member);
      }
      return 1;
    },
    async set(
      key: string,
      value: string,
      options?: { EX?: number; NX?: boolean },
    ) {
      if (options?.NX && values.has(key)) return null;
      values.set(key, value);
      if (options?.EX) expirations.set(key, options.EX);
      return "OK";
    },
  };
}
