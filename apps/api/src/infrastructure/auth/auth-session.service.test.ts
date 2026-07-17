import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthSessionToken, parseAuthSessionToken } from "./auth-session.js";

const secret = "test-session-secret-with-sufficient-entropy";

describe("auth session token boundaries", () => {
  it("keeps platform sessions tenantless", () => {
    const token = createAuthSessionToken(
      {
        jti: "jti-platform",
        principalType: "platform",
        sessionId: "platform-session",
        tenantId: null,
        userId: "platform-user",
      },
      { secret, ttlSeconds: 60 },
    );
    assert.equal(parseAuthSessionToken(token, { secret })?.tenantId, null);
    assert.equal(parseAuthSessionToken(token, { secret })?.principalType, "platform");
  });

  it("binds tenant sessions and integration tokens to one tenant", () => {
    for (const principalType of ["tenant", "integration"] as const) {
      const token = createAuthSessionToken(
        {
          jti: `jti-${principalType}`,
          principalType,
          sessionId: `${principalType}-session`,
          tenantId: "tenant-a",
          userId: "user-a",
        },
        { secret, ttlSeconds: 60 },
      );
      const parsed = parseAuthSessionToken(token, { secret });
      assert.equal(parsed?.tenantId, "tenant-a");
      assert.equal(parsed?.userId, "user-a");
    }
  });

  it("rejects tampered tokens", () => {
    const token = createAuthSessionToken(
      {
        jti: "jti-a",
        principalType: "tenant",
        sessionId: "session-a",
        tenantId: "tenant-a",
        userId: "user-a",
      },
      { secret, ttlSeconds: 60 },
    );
    assert.equal(parseAuthSessionToken(`${token}x`, { secret }), null);
  });
});
