import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { NextRequest } from "next/server";
import { POST } from "../../app/api/admin/[...path]/route";
import {
  WEB_SESSION_COOKIE_NAME,
  sealWebSession,
  type WebSession,
} from "./web-session";

const originalFetch = globalThis.fetch;
const originalSecret = process.env.WEB_SESSION_SECRET;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalSecret === undefined) {
    delete process.env.WEB_SESSION_SECRET;
  } else {
    process.env.WEB_SESSION_SECRET = originalSecret;
  }
});

describe("admin BFF refresh single-flight", () => {
  it("shares one upstream refresh for concurrent explicit refresh requests", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession();
    let refreshRequests = 0;
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "http://localhost:3200/api/admin/auth/refresh");
      refreshRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      return new Response(
        JSON.stringify({
          accessToken: "next-access-token",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          sessionId: session.sessionId,
        }),
        {
          headers: {
            "content-type": "application/json",
            "set-cookie": "hermes_refresh=next-refresh-token; Path=/api/admin/auth; HttpOnly",
          },
          status: 200,
        },
      );
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => sendRefreshRequest(session)),
    );

    assert.equal(refreshRequests, 1);
    for (const response of responses) {
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("set-cookie")?.includes(WEB_SESSION_COOKIE_NAME), true);
    }
  });

  it("shares one upstream refresh when concurrent requests preemptively refresh an expiring session", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession({ expiresAt: new Date(Date.now() - 1).toISOString() });
    let refreshRequests = 0;
    let apiRequests = 0;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return refreshResponse(session);
      }
      apiRequests += 1;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "content-type": "application/json" },
        status: 200,
      });
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => sendProtectedRequest(session)),
    );

    assert.equal(refreshRequests, 1);
    assert.equal(apiRequests, 10);
    assert.deepEqual(await responses[0]!.json(), { ok: true });
  });

  it("shares one upstream refresh after concurrent upstream 401 responses", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession();
    let refreshRequests = 0;
    let apiRequests = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.endsWith("/auth/refresh")) {
        refreshRequests += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return refreshResponse(session);
      }
      apiRequests += 1;
      const authorization = new Headers(init?.headers).get("authorization");
      return new Response(JSON.stringify({ ok: authorization === "Bearer next-access-token" }), {
        headers: { "content-type": "application/json" },
        status: authorization === "Bearer next-access-token" ? 200 : 401,
      });
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () => sendProtectedRequest(session)),
    );

    assert.equal(refreshRequests, 1);
    assert.equal(apiRequests, 20);
    assert.deepEqual(await responses[0]!.json(), { ok: true });
  });
});

async function sendRefreshRequest(session: WebSession) {
  const request = new NextRequest("http://localhost:3100/api/admin/auth/refresh", {
    headers: {
      cookie: `${WEB_SESSION_COOKIE_NAME}=${sealWebSession(session)}`,
      "user-agent": "test-agent",
    },
    method: "POST",
  });
  return POST(request, { params: Promise.resolve({ path: ["auth", "refresh"] }) });
}

async function sendProtectedRequest(session: WebSession) {
  const request = new NextRequest("http://localhost:3100/api/admin/auth/me", {
    headers: {
      cookie: `${WEB_SESSION_COOKIE_NAME}=${sealWebSession(session)}`,
      "user-agent": "test-agent",
    },
  });
  return POST(request, { params: Promise.resolve({ path: ["auth", "me"] }) });
}

function refreshResponse(session: WebSession) {
  return new Response(
    JSON.stringify({
      accessToken: "next-access-token",
      expiresAt: new Date(Date.now() + 300_000).toISOString(),
      sessionId: session.sessionId,
    }),
    {
      headers: {
        "content-type": "application/json",
        "set-cookie": "hermes_refresh=next-refresh-token; Path=/api/admin/auth; HttpOnly",
      },
      status: 200,
    },
  );
}

function createSession(overrides: Partial<WebSession> = {}): WebSession {
  return {
    accessToken: "access-token",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    refreshToken: "refresh-token",
    sessionId: "session-1",
    ...overrides,
  };
}