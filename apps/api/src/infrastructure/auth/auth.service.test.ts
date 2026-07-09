import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { AuthService } from "./auth.service.js";

describe("AuthService interactive session guard", () => {
  it("rejects malformed login payloads before querying users", async () => {
    let queried = false;
    const service = createAuthService({
      userRepository: {
        findOne: async () => {
          queried = true;
          return null;
        },
      },
    });

    await assert.rejects(
      () => service.login(null as any, {}, { cookie() {} }),
      UnauthorizedException,
    );
    await assert.rejects(
      () =>
        service.login(
          { email: 42, password: "password-123" } as any,
          {},
          { cookie() {} },
        ),
      UnauthorizedException,
    );
    assert.equal(queried, false);
  });

  it("revokes the refreshed session and clears the cookie when the user is disabled", async () => {
    const revoked: any[] = [];
    const cleared: any[] = [];
    const cookies: any[] = [];
    const service = createAuthService({
      authSessionService: {
        getClearRefreshCookieOptions: () => ({ path: "/api/admin/auth" }),
        getRefreshCookieName: () => "hermes_refresh",
        getRefreshCookieOptions: () => ({ path: "/api/admin/auth" }),
        refreshSession: async () => ({
          accessToken: "next-access",
          expiresAt: "2026-07-09T00:00:00.000Z",
          refreshToken: "next-refresh",
          sessionId: "session-1",
          userId: "user-1",
        }),
        revokeSession: async (...args: any[]) => {
          revoked.push(args);
        },
      },
      userRepository: {
        findOne: async () => ({
          id: "user-1",
          status: "disabled",
        }),
      },
    });

    await assert.rejects(
      () =>
        service.refresh(
          { headers: { cookie: "hermes_refresh=refresh-token" } },
          {
            clearCookie: (...args: any[]) => cleared.push(args),
            cookie: (...args: any[]) => cookies.push(args),
          },
        ),
      { message: "用户不可用" },
    );

    assert.deepEqual(revoked, [["session-1", "user-1"]]);
    assert.equal(cleared.length, 1);
    assert.equal(cookies.length, 0);
  });

  it("rejects integration tokens from login session management", async () => {
    const service = createAuthService({
      authSessionService: {
        validateAccessToken: async () => ({
          integrationToken: {
            id: "token-1",
            organizationId: null,
            permissions: ["page.home.access:own"],
            scope: "own",
          },
          sessionId: "integration:token-1",
          tokenKind: "integration",
          userId: "user-1",
        }),
      },
    });

    await assert.rejects(
      () => service.listSessions("Bearer integration-token"),
      UnauthorizedException,
    );
  });
});

function createAuthService(options: {
  authSessionService?: Record<string, any>;
  userRepository?: Record<string, any>;
} = {}) {
  return new AuthService(
    (options.userRepository ?? {}) as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    (options.authSessionService ?? {}) as any,
    {} as any,
  );
}
