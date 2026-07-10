import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import {
  INTEGRATION_SESSION_PREFIX,
  createAuthSessionToken,
} from "./auth-session.js";
import { AuthSessionService } from "./auth-session.service.js";

describe("AuthSessionService Redis-backed sessions", () => {
  it("rotates refresh tokens and rejects the old token after the concurrency window", async () => {
    const { redis, service } = createService();
    const created = await service.createSession("user-1", {
      ipAddress: "127.0.0.1",
      userAgent: chromeWindowsUserAgent,
    });

    const refreshed = await service.refreshSession(created.refreshToken, {
      ipAddress: "127.0.0.2",
      userAgent: chromeWindowsUserAgent,
    });

    assert.equal(refreshed.sessionId, created.sessionId);
    assert.notEqual(refreshed.refreshToken, created.refreshToken);
    await redis.del(redis.findKey("auth:refresh_rotation:"));
    await assert.rejects(
      () => service.refreshSession(created.refreshToken),
      UnauthorizedException,
    );
    await assert.doesNotReject(() =>
      service.refreshSession(refreshed.refreshToken),
    );
  });

  it("returns the same rotation result to concurrent refresh requests", async () => {
    const { service } = createService();
    const created = await service.createSession("user-1");

    const results = await Promise.all(
      Array.from({ length: 10 }, () => service.refreshSession(created.refreshToken)),
    );

    assert.equal(new Set(results.map((result) => result.accessToken)).size, 1);
    assert.equal(new Set(results.map((result) => result.refreshToken)).size, 1);
    assert.equal(new Set(results.map((result) => result.sessionId)).size, 1);
    await assert.doesNotReject(() => service.refreshSession(results[0]!.refreshToken));
  });

  it("does not reveal refresh rotation material in Redis plaintext", async () => {
    const { redis, service } = createService();
    const created = await service.createSession("user-1");
    const refreshed = await service.refreshSession(created.refreshToken);
    const rotation = redis.getRaw(redis.findKey("auth:refresh_rotation:"));

    assert.equal(rotation.includes(refreshed.accessToken), false);
    assert.equal(rotation.includes(refreshed.refreshToken), false);
  });

  it("does not let access-token validation overwrite a concurrently rotated refresh hash", async () => {
    const { redis, service } = createService();
    const created = await service.createSession("user-1");

    const pause = redis.pauseNextSessionGet();
    const validatePromise = service.validateAccessToken(created.accessToken);
    await pause.waitUntilRead();

    const refreshed = await service.refreshSession(created.refreshToken);
    pause.release();
    await validatePromise;

    await assert.doesNotReject(() =>
      service.refreshSession(refreshed.refreshToken),
    );
  });

  it("fails closed for malformed session expiration dates", async () => {
    const { redis, service } = createService();
    const created = await service.createSession("user-1");
    const sessionKey = redis.findKey("auth:session:");
    const record = redis.getJsonRecord(sessionKey);
    record.expiresAt = "not-a-date";
    redis.setRaw(sessionKey, JSON.stringify(record));

    await assert.rejects(
      () => service.validateAccessToken(created.accessToken),
      UnauthorizedException,
    );
  });

  it("rejects existing access tokens after the user is disabled", async () => {
    const { service, users } = createService();
    const created = await service.createSession("user-1");
    users.set("user-1", { id: "user-1", status: "disabled" });

    await assert.rejects(
      () => service.validateAccessToken(created.accessToken),
      UnauthorizedException,
    );
  });

  it("rejects organization integration tokens when the organization is disabled", async () => {
    const token = createIntegrationToken(
      "token-organization-1",
      "user-1",
      "test-session-secret",
    );
    const { service } = createService({
      integrationTokenRepository: createIntegrationTokenRepository(
        token,
        "token-organization-1",
        { organizationId: "organization-1", scope: "organization" },
      ),
      organizationRepository: {
        findOne: async () => ({ id: "organization-1", status: "suspended" }),
      },
    });

    await assert.rejects(
      () => service.validateAccessToken(token),
      UnauthorizedException,
    );
  });

  it("rejects organization integration tokens when the organization is missing", async () => {
    const token = createIntegrationToken(
      "token-organization-missing",
      "user-1",
      "test-session-secret",
    );
    const { service } = createService({
      integrationTokenRepository: createIntegrationTokenRepository(
        token,
        "token-organization-missing",
        { organizationId: "organization-missing", scope: "organization" },
      ),
      organizationRepository: { findOne: async () => null },
    });

    await assert.rejects(
      () => service.validateAccessToken(token),
      UnauthorizedException,
    );
  });
  it("accepts organization integration tokens for active organizations", async () => {
    const token = createIntegrationToken(
      "token-organization-2",
      "user-1",
      "test-session-secret",
    );
    const { service } = createService({
      integrationTokenRepository: createIntegrationTokenRepository(
        token,
        "token-organization-2",
        { organizationId: "organization-1", scope: "organization" },
      ),
      organizationRepository: {
        findOne: async ({ where }: any) =>
          where.id === "organization-1"
            ? { id: "organization-1", status: "active" }
            : null,
      },
    });

    await assert.doesNotReject(() => service.validateAccessToken(token));
  });

  it("does not query organizations for non-organization integration tokens", async () => {
    const token = createIntegrationToken(
      "token-platform-1",
      "user-1",
      "test-session-secret",
    );
    let organizationQueries = 0;
    const { service } = createService({
      integrationTokenRepository: createIntegrationTokenRepository(
        token,
        "token-platform-1",
        { organizationId: null, scope: "platform" },
      ),
      organizationRepository: {
        findOne: async () => {
          organizationQueries += 1;
          return null;
        },
      },
    });

    await assert.doesNotReject(() => service.validateAccessToken(token));
    assert.equal(organizationQueries, 0);
  });
  it("does not let integration token validation overwrite a concurrent revocation", async () => {
    const token = createIntegrationToken("token-1", "user-1", "test-session-secret");
    const record = {
      createdAt: new Date("2026-07-07T00:00:00Z"),
      expiresAt: new Date(Date.now() + 60_000),
      id: "token-1",
      lastUsedAt: null as Date | null,
      note: "CI",
      organizationId: null,
      ownerUserId: "user-1",
      permissions: ["page.home.access:own"],
      revokedAt: null as Date | null,
      scope: "own" as const,
      tokenHash: hashTokenForTest(token),
      updatedAt: new Date("2026-07-07T00:00:00Z"),
    };
    let updateWhere: any = null;
    let saveCalled = false;
    const { service } = createService({
      integrationTokenRepository: {
        findOne: async () => ({ ...record }),
        save: async () => {
          saveCalled = true;
          return record;
        },
        update: async (where: any) => {
          updateWhere = where;
          record.revokedAt = new Date();
          return { affected: 0 };
        },
      },
    });

    await assert.rejects(
      () => service.validateAccessToken(token),
      UnauthorizedException,
    );

    assert.equal(saveCalled, false);
    assert.equal(updateWhere.id, "token-1");
    assert.equal(updateWhere.ownerUserId, "user-1");
    assert.equal(record.revokedAt instanceof Date, true);
  });

  it("consumes realtime tickets at most once under concurrent use", async () => {
    const { service } = createService();
    const created = await service.createSession("user-1");
    const ticket = await service.createRealtimeTicket({
      sessionId: created.sessionId,
      userId: "user-1",
    });

    const results = await Promise.allSettled([
      service.consumeRealtimeTicket(ticket.ticket),
      service.consumeRealtimeTicket(ticket.ticket),
    ]);

    assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
    );
  });
});

function createService(options: {
  integrationTokenRepository?: unknown;
  organizationRepository?: unknown;
} = {}) {
  const redis = new FakeRedisClient();
  const users = new Map<string, { id: string; status: string }>([
    ["user-1", { id: "user-1", status: "active" }],
  ]);
  const service = new AuthSessionService(
    (options.integrationTokenRepository ?? { findOne: async () => null }) as any,
    {
      findOne: async ({ where }: any) => users.get(where.id) ?? null,
    } as any,
    (options.organizationRepository ?? { findOne: async () => null }) as any,
    {
      getOrThrow: (key: string) => {
        const values: Record<string, unknown> = {
          "auth.accessTokenTtlSeconds": 900,
          "auth.refreshCookieName": "hermes_refresh",
          "auth.refreshCookieSecure": false,
          "auth.refreshTokenTtlSeconds": 60 * 60 * 24 * 30,
          "auth.sessionSecret": "test-session-secret",
        };
        if (!(key in values)) {
          throw new Error(`Missing config key ${key}`);
        }
        return values[key];
      },
    } as any,
    {
      getClient: async () => redis,
    } as any,
  );
  return { redis, service, users };
}

function createIntegrationTokenRepository(
  token: string,
  id: string,
  overrides: {
    organizationId: string | null;
    scope: "organization" | "own" | "platform";
  },
) {
  const record = {
    createdAt: new Date("2026-07-07T00:00:00Z"),
    expiresAt: new Date(Date.now() + 60_000),
    id,
    lastUsedAt: null as Date | null,
    note: "CI",
    ownerUserId: "user-1",
    permissions: [],
    revokedAt: null as Date | null,
    tokenHash: hashTokenForTest(token),
    updatedAt: new Date("2026-07-07T00:00:00Z"),
    ...overrides,
  };

  return {
    findOne: async () => ({ ...record }),
    update: async () => ({ affected: 1 }),
  };
}
class FakeRedisClient {
  private readonly values = new Map<string, string>();
  private readonly setValues = new Map<string, Set<string>>();
  private pausedSessionGet: PausedSessionGet | null = null;

  pauseNextSessionGet() {
    let read!: () => void;
    let release!: () => void;
    const readPromise = new Promise<void>((resolve) => {
      read = resolve;
    });
    const releasePromise = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.pausedSessionGet = { read, releasePromise };
    return {
      release,
      waitUntilRead: () => readPromise,
    };
  }

  async get(key: string) {
    if (key.startsWith("auth:session:") && this.pausedSessionGet) {
      const paused = this.pausedSessionGet;
      this.pausedSessionGet = null;
      const value = this.values.get(key) ?? null;
      paused.read();
      await paused.releasePromise;
      return value;
    }
    return this.values.get(key) ?? null;
  }

  async getDel(key: string) {
    const value = this.values.get(key) ?? null;
    this.values.delete(key);
    return value;
  }

  async set(
    key: string,
    value: string,
    options?: { EX?: number; NX?: boolean },
  ) {
    if (options?.NX && this.values.has(key)) {
      return null;
    }
    this.values.set(key, value);
    return "OK";
  }

  async del(...keys: string[]) {
    let deleted = 0;
    for (const key of keys.flat()) {
      if (this.values.delete(key)) deleted += 1;
    }
    return deleted;
  }

  async eval(
    _script: string,
    options: { arguments: string[]; keys: string[] },
  ) {
    const [key] = options.keys;
    const [owner] = options.arguments;
    if (!key || this.values.get(key) !== owner) return 0;
    this.values.delete(key);
    return 1;
  }

  async sAdd(key: string, member: string) {
    const set = this.setValues.get(key) ?? new Set<string>();
    set.add(member);
    this.setValues.set(key, set);
    return 1;
  }

  async sMembers(key: string) {
    return [...(this.setValues.get(key) ?? new Set<string>())];
  }

  async sRem(key: string, members: string | string[]) {
    const set = this.setValues.get(key);
    if (!set) return 0;
    let removed = 0;
    for (const member of Array.isArray(members) ? members : [members]) {
      if (set.delete(member)) removed += 1;
    }
    return removed;
  }

  async expire() {
    return true;
  }

  findKey(prefix: string) {
    const key = [...this.values.keys()].find((item) => item.startsWith(prefix));
    assert.ok(key, `Expected Redis key with prefix ${prefix}`);
    return key;
  }

  getJsonRecord(key: string) {
    const value = this.values.get(key);
    assert.ok(value, `Expected Redis value for ${key}`);
    return JSON.parse(value) as Record<string, unknown>;
  }

  setRaw(key: string, value: string) {
    this.values.set(key, value);
  }

  getRaw(key: string) {
    const value = this.values.get(key);
    assert.ok(value, `Expected Redis key ${key}`);
    return value;
  }
}

type PausedSessionGet = {
  read: () => void;
  releasePromise: Promise<void>;
};

const chromeWindowsUserAgent =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function createIntegrationToken(tokenId: string, userId: string, secret: string) {
  return createAuthSessionToken(
    {
      jti: randomUUID(),
      sessionId: `${INTEGRATION_SESSION_PREFIX}${tokenId}`,
      userId,
    },
    {
      secret,
      ttlSeconds: 60,
    },
  );
}

function hashTokenForTest(token: string) {
  return createHash("sha256").update(token).digest("hex");
}
