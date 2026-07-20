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
  it("forwards the browser host for public tenant discovery and overwrites spoofed values", async () => {
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-forwarded-host"), "acme.example.com");
      assert.equal(headers.has("authorization"), false);
      return Response.json({ source: "host", tenant: { name: "Acme", slug: "acme" } });
    };
    const request = new NextRequest(
      "http://acme.example.com/api/admin/auth/tenant-context",
      {
        headers: { "x-forwarded-host": "spoofed.example.com" },
        method: "POST",
      },
    );
    const response = await POST(request, {
      params: Promise.resolve({ path: ["auth", "tenant-context"] }),
    });
    assert.equal(response.status, 200);
  });

  it("uses the isolated platform refresh endpoint for platform sessions", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession({ principalType: "platform" });
    globalThis.fetch = async (input) => {
      assert.equal(
        String(input),
        "http://localhost:3200/api/admin/platform/auth/refresh",
      );
      return refreshResponse(session);
    };

    const response = await sendRefreshRequest(session);

    assert.equal(response.status, 200);
  });

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

  it("keeps the web session when the refresh service is temporarily unavailable", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession({
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });
    globalThis.fetch = async () =>
      Response.json(
        { message: "Service unavailable" },
        { status: 503 },
      );

    const response = await sendRefreshRequest(session);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      message: "认证服务暂时不可用，请稍后重试",
    });
    assert.equal(response.headers.get("set-cookie"), null);
  });

  it("uses a still-valid access token when preemptive refresh is temporarily unavailable", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession({
      expiresAt: new Date(Date.now() + 30_000).toISOString(),
    });
    let apiRequests = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).endsWith("/auth/refresh")) {
        throw new TypeError("fetch failed");
      }
      apiRequests += 1;
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer access-token",
      );
      return Response.json({ ok: true });
    };

    const response = await sendProtectedRequest(session);

    assert.equal(response.status, 200);
    assert.equal(apiRequests, 1);
    assert.deepEqual(await response.json(), { ok: true });
  });

  it("clears the web session only when the refresh token is rejected", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession({
      expiresAt: new Date(Date.now() - 1).toISOString(),
    });
    globalThis.fetch = async () =>
      Response.json(
        { message: "登录已失效，请重新登录" },
        { status: 401 },
      );

    const response = await sendRefreshRequest(session);

    assert.equal(response.status, 401);
    assert.equal(
      response.headers.get("set-cookie")?.includes(WEB_SESSION_COOKIE_NAME),
      true,
    );
    assert.equal(response.headers.get("set-cookie")?.includes("Max-Age=0"), true);
  });

  it("rejects authenticated mutations without the matching CSRF token", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const warnings: string[] = [];
    const originalWarn = console.warn;
    console.warn = (message?: unknown) => warnings.push(String(message));
    const session = createSession();
    const request = new NextRequest(
      "http://localhost:3100/api/admin/users/user-1",
      {
        headers: {
          cookie: `${WEB_SESSION_COOKIE_NAME}=${sealWebSession(session)}`,
          origin: "http://localhost:3100",
        },
        method: "DELETE",
      },
    );

    let response: Response;
    try {
      response = await POST(request, {
        params: Promise.resolve({ path: ["users", "user-1"] }),
      });
    } finally {
      console.warn = originalWarn;
    }

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      code: "CSRF_TOKEN_INVALID",
      message: "请求来源验证失败",
      statusCode: 403,
    });
    assert.deepEqual(JSON.parse(warnings[0] ?? "{}"), {
      code: "CSRF_TOKEN_INVALID",
      event: "csrf.denied",
      method: "DELETE",
      path: "/api/admin/users/user-1",
    });
  });
});

async function sendRefreshRequest(session: WebSession) {
  const request = new NextRequest("http://localhost:3100/api/admin/auth/refresh", {
    headers: {
      cookie: `${WEB_SESSION_COOKIE_NAME}=${sealWebSession(session)}`,
      origin: "http://localhost:3100",
      "user-agent": "test-agent",
      "x-csrf-token": session.csrfToken!,
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
    csrfToken: "csrf-token",
    expiresAt: new Date(Date.now() + 300_000).toISOString(),
    refreshToken: "refresh-token",
    sessionId: "session-1",
    ...overrides,
  };
}
