import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { sealWebSession, unsealWebSession, type WebSession } from "./web-session";

const originalSecret = process.env.WEB_SESSION_SECRET;

afterEach(() => {
  if (originalSecret === undefined) {
    delete process.env.WEB_SESSION_SECRET;
  } else {
    process.env.WEB_SESSION_SECRET = originalSecret;
  }
});

describe("web session sealing", () => {
  it("roundtrips encrypted web sessions", () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession();
    const sealed = sealWebSession(session);

    assert.notEqual(sealed.includes(session.accessToken), true);
    assert.deepEqual(unsealWebSession(sealed), session);
  });

  it("rejects tampered cookies", () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const sealed = sealWebSession(createSession());
    const tampered = `${sealed.slice(0, -1)}x`;

    assert.equal(unsealWebSession(tampered), null);
  });
});

function createSession(): WebSession {
  return {
    accessToken: "access-token",
    csrfToken: "csrf-token",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    refreshToken: "refresh-token",
    sessionId: "session-1",
  };
}
