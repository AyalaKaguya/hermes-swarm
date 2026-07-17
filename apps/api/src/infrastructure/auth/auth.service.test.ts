import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { hashPassword } from "../../common/security/password-hash.js";
import { AuthService } from "./auth.service.js";

describe("AuthService identity plane isolation", () => {
  it("logs platform users into a tenantless platform session", async () => {
    const created: unknown[][] = [];
    const service = createService({
      authSessionService: {
        createSession: async (...args: unknown[]) => {
          created.push(args);
          return issuedSession("platform");
        },
        getRefreshCookieName: () => "refresh",
        getRefreshCookieOptions: () => ({}),
      },
      platformUserRepository: {
        findOne: async () => ({
          displayName: "Platform Admin",
          email: "admin@example.com",
          id: "platform-user",
          passwordHash: hashPassword("password-123"),
          roles: [],
          status: "active",
        }),
      },
    });
    const result = await service.loginPlatform(
      { email: "admin@example.com", password: "password-123" },
      {},
      { cookie() {} },
    );
    assert.deepEqual(created[0]?.slice(0, 3), ["platform-user", null, "platform"]);
    assert.equal(result.snapshot.principalType, "platform");
  });

  it("queries tenant users only inside the resolved tenant", async () => {
    const queries: unknown[] = [];
    const user = {
      email: "shared@example.com",
      id: "user-a",
      passwordHash: hashPassword("tenant-password"),
      status: "active",
      tenantId: "tenant-a",
    };
    const service = createService({
      dataSource: {
        transaction: async (work: (manager: unknown) => unknown) =>
          work({
            getRepository: () => ({
              findOne: async (query: unknown) => {
                queries.push(query);
                return user;
              },
            }),
            query: async () => undefined,
          }),
      },
      tenantLoginResolver: {
        resolve: async () => ({ source: "workspace", tenant: { id: "tenant-a", name: "A", slug: "a" } }),
      },
    });
    (service as unknown as { createLoginResponse: (user: unknown) => unknown }).createLoginResponse =
      async () => ({ userId: "user-a" });
    const result = await service.login(
      { email: "Shared@Example.com", password: "tenant-password", tenantSlug: "a" },
      {},
      { cookie() {} },
    );
    assert.deepEqual((queries[0] as { where: unknown }).where, {
      email: "shared@example.com",
      tenantId: "tenant-a",
    });
    assert.deepEqual(result, { userId: "user-a" });
  });

  it("never falls back to a global user lookup without tenant resolution", async () => {
    let transactionStarted = false;
    const service = createService({
      dataSource: { transaction: async () => { transactionStarted = true; } },
      tenantLoginResolver: { resolve: async () => null },
    });
    await assert.rejects(
      service.login(
        { email: "shared@example.com", password: "password-123" },
        {},
        { cookie() {} },
      ),
      UnauthorizedException,
    );
    assert.equal(transactionStarted, false);
  });
});

function createService(options: Record<string, Record<string, unknown>> = {}) {
  return new AuthService(
    (options.authSessionService ?? {}) as never,
    (options.platformUserRepository ?? {}) as never,
    (options.dataSource ?? {}) as never,
    { run: (_context: unknown, work: () => unknown) => work() } as never,
    (options.tenantLoginResolver ?? { resolve: async () => null }) as never,
  );
}

function issuedSession(principalType: "platform" | "tenant") {
  return {
    accessToken: "access",
    expiresAt: "2030-01-01T00:00:00.000Z",
    principalType,
    refreshToken: "refresh",
    sessionId: "session",
    tenantId: principalType === "tenant" ? "tenant-a" : null,
  };
}
