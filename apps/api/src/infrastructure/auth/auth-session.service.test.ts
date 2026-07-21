import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createAuthSessionToken, parseAuthSessionToken } from "./auth-session.js";

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
