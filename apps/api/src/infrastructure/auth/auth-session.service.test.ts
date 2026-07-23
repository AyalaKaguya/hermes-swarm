import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { UnauthorizedException } from "@nestjs/common";
import { createAuthSessionToken, parseAuthSessionToken } from "./auth-session.js";
import { encryptRefreshRotation } from "./auth-session-security.js";
import { AuthSessionService } from "./auth-session.service.js";

const secret = "test-session-secret-with-sufficient-entropy";

describe("auth session token boundaries", () => {
  it("keeps platform sessions workspaceless", () => {
    const token = createAuthSessionToken(
      {
        jti: "jti-platform",
        principalType: "platform",
        sessionId: "platform-session",
        workspaceId: null,
        userId: "platform-user",
      },
      { secret, ttlSeconds: 60 },
    );
    assert.equal(parseAuthSessionToken(token, { secret })?.workspaceId, null);
    assert.equal(parseAuthSessionToken(token, { secret })?.principalType, "platform");
  });

  it("binds workspace sessions and integration tokens to one workspace", () => {
    for (const principalType of ["workspace", "integration"] as const) {
      const token = createAuthSessionToken(
        {
          jti: `jti-${principalType}`,
          principalType,
          sessionId: `${principalType}-session`,
          workspaceId: "workspace-a",
          userId: "user-a",
        },
        { secret, ttlSeconds: 60 },
      );
      const parsed = parseAuthSessionToken(token, { secret });
      assert.equal(parsed?.workspaceId, "workspace-a");
      assert.equal(parsed?.userId, "user-a");
    }
  });

  it("rejects tampered tokens", () => {
    const token = createAuthSessionToken(
      {
        jti: "jti-a",
        principalType: "workspace",
        sessionId: "session-a",
        workspaceId: "workspace-a",
        userId: "user-a",
      },
      { secret, ttlSeconds: 60 },
    );
    assert.equal(parseAuthSessionToken(`${token}x`, { secret }), null);
  });

  it("binds credential version and key ID while supporting a bounded previous key", () => {
    const token = createAuthSessionToken(
      {
        credentialVersion: 7,
        jti: "jti-rotated",
        principalType: "workspace",
        sessionId: "session-rotated",
        workspaceId: "workspace-a",
        userId: "user-a",
      },
      { keyId: "previous", secret, ttlSeconds: 60 },
    );
    assert.equal(
      parseAuthSessionToken(token, {
        keyId: "current",
        previousKeys: { previous: secret },
        secret: "current-session-secret-with-sufficient-entropy",
      })?.credentialVersion,
      7,
    );
    assert.equal(
      parseAuthSessionToken(token, {
        keyId: "current",
        secret: "current-session-secret-with-sufficient-entropy",
      }),
      null,
    );
  });
});

describe("refresh session coordination", () => {
  it("returns a completed rotation to a concurrent refresh request", async () => {
    const rotated = {
      accessToken: "rotated-access-token",
      expiresAt: "2030-01-01T00:00:00.000Z",
      principalType: "platform" as const,
      refreshToken: "rotated-refresh-token",
      sessionId: "session-1",
      userId: "account-1",
      workspaceId: null,
    };
    const encrypted = encryptRefreshRotation(rotated, secret);
    let lookups = 0;
    const service = createRefreshSessionService({
      acquireRefreshLock: async () => false,
      getRefreshRotationResult: async () => {
        lookups += 1;
        return lookups === 1 ? null : encrypted;
      },
    });

    assert.deepEqual(await service.refreshSession("stale-refresh-token"), rotated);
    assert.equal(lookups >= 2, true);
  });

  it("marks a confirmed unknown refresh token as invalid", async () => {
    let released = false;
    const service = createRefreshSessionService({
      acquireRefreshLock: async () => true,
      getRefreshIndex: async () => null,
      getRefreshRotationResult: async () => null,
      releaseRefreshLock: async () => {
        released = true;
      },
    });

    await assert.rejects(
      service.refreshSession("unknown-refresh-token"),
      (error: unknown) => {
        assert.equal(error instanceof UnauthorizedException, true);
        assert.deepEqual((error as UnauthorizedException).getResponse(), {
          code: "AUTH_REFRESH_TOKEN_INVALID",
          message: "登录已失效，请重新登录",
          statusCode: 401,
        });
        return true;
      },
    );
    assert.equal(released, true);
  });
});

function createRefreshSessionService(sessionStore: Record<string, unknown>) {
  return new AuthSessionService(
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      getOrThrow: (key: string) => {
        if (key === "auth.sessionSecret") return secret;
        if (key === "auth.accessTokenTtlSeconds") return 900;
        if (key === "auth.refreshTokenTtlSeconds") return 2_592_000;
        throw new Error(`Unexpected config key: ${key}`);
      },
    } as never,
    {} as never,
    {} as never,
    sessionStore as never,
  );
}
