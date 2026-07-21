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
  it("returns context choices without requiring an authenticated web session", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    globalThis.fetch = async (input) => {
      assert.equal(String(input), "http://localhost:3200/api/admin/auth/login");
      return Response.json({
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
        selectionToken: "selection-token",
        contexts: [workspaceContextOption()],
        status: "context_selection_required",
      });
    };
    const request = new NextRequest(
      "http://localhost:3100/api/admin/auth/login",
      { method: "POST" },
    );

    const response = await POST(request, {
      params: Promise.resolve({ path: ["auth", "login"] }),
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, "context_selection_required");
  });

  it("returns a sanitized 502 when the upstream authentication response violates its contract", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const originalError = console.error;
    console.error = () => undefined;
    globalThis.fetch = async () => Response.json({ accessToken: "must-not-leak" });
    const request = new NextRequest(
      "http://localhost:3100/api/admin/auth/login",
      { method: "POST" },
    );

    let response: Response;
    try {
      response = await POST(request, {
        params: Promise.resolve({ path: ["auth", "login"] }),
      });
    } finally {
      console.error = originalError;
    }

    assert.equal(response.status, 502);
    const body = await response.json();
    assert.deepEqual(body, { message: "认证服务响应格式无效" });
    assert.equal(JSON.stringify(body).includes("must-not-leak"), false);
  });

  it("establishes the web session after selecting a context", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    globalThis.fetch = async (input) => {
      assert.equal(
        String(input),
        "http://localhost:3200/api/admin/auth/select-context",
      );
      return new Response(
        JSON.stringify({
          accessToken: "workspace-access-token",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          sessionId: "workspace-session",
          snapshot: workspacePrincipal(),
          status: "authenticated",
        }),
        {
          headers: {
            "content-type": "application/json",
            "set-cookie": "hermes_refresh=workspace-refresh-token; Path=/api/admin/auth; HttpOnly",
          },
        },
      );
    };
    const request = new NextRequest(
      "http://localhost:3100/api/admin/auth/select-context",
      { method: "POST" },
    );

    const response = await POST(request, {
      params: Promise.resolve({ path: ["auth", "select-context"] }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.accessToken, undefined);
    assert.equal(body.snapshot.workspace.slug, "hermes-dev");
    assert.equal(
      response.headers.get("set-cookie")?.includes(WEB_SESSION_COOKIE_NAME),
      true,
    );
  });

  it("rotates the sealed web session when switching contexts", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession();
    globalThis.fetch = async (input, init) => {
      assert.equal(
        String(input),
        "http://localhost:3200/api/admin/auth/switch-context",
      );
      assert.equal(
        new Headers(init?.headers).get("authorization"),
        "Bearer access-token",
      );
      return new Response(
        JSON.stringify({
          accessToken: "switched-access-token",
          expiresAt: new Date(Date.now() + 300_000).toISOString(),
          sessionId: "switched-session",
          snapshot: workspacePrincipal({
            id: "workspace-2",
            name: "Hermes dev lab",
            slug: "hermes-dev-lab",
            status: "active",
          }),
          status: "authenticated",
        }),
        {
          headers: {
            "content-type": "application/json",
            "set-cookie": "hermes_refresh=switched-refresh-token; Path=/api/admin/auth; HttpOnly",
          },
        },
      );
    };
    const request = new NextRequest(
      "http://localhost:3100/api/admin/auth/switch-context",
      {
        headers: {
          cookie: `${WEB_SESSION_COOKIE_NAME}=${sealWebSession(session)}`,
          origin: "http://localhost:3100",
          "x-csrf-token": session.csrfToken!,
        },
        method: "POST",
      },
    );

    const response = await POST(request, {
      params: Promise.resolve({ path: ["auth", "switch-context"] }),
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.accessToken, undefined);
    assert.equal(body.snapshot.workspace.slug, "hermes-dev-lab");
    assert.equal(
      response.headers.get("set-cookie")?.includes(WEB_SESSION_COOKIE_NAME),
      true,
    );
  });

  it("forwards the browser host for public workspace discovery and overwrites spoofed values", async () => {
    globalThis.fetch = async (_input, init) => {
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("x-forwarded-host"), "acme.example.com");
      assert.equal(headers.has("authorization"), false);
      return Response.json({ source: "host", workspace: { name: "Acme", slug: "acme" } });
    };
    const request = new NextRequest(
      "http://acme.example.com/api/admin/auth/workspace-context",
      {
        headers: { "x-forwarded-host": "spoofed.example.com" },
        method: "POST",
      },
    );
    const response = await POST(request, {
      params: Promise.resolve({ path: ["auth", "workspace-context"] }),
    });
    assert.equal(response.status, 200);
  });

  it("uses the unified refresh endpoint for platform sessions", async () => {
    process.env.WEB_SESSION_SECRET = "test-secret";
    const session = createSession({ principalType: "platform" });
    globalThis.fetch = async (input) => {
      assert.equal(
        String(input),
        "http://localhost:3200/api/admin/auth/refresh",
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
      "http://localhost:3100/api/admin/workspace/members/user-1",
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
      path: "/api/admin/workspace/members/user-1",
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

const TEST_DATE = "2026-07-21T00:00:00.000Z";

function role(workspaceId = "workspace-1") {
  return {
    color: null,
    description: null,
    displayName: "Workspace owner",
    id: "role-1",
    isSystem: true,
    label: "Workspace owner",
    name: "workspace-owner",
    permissions: [],
    scope: "workspace",
    workspaceId,
  };
}

function account() {
  return {
    avatarUrl: null,
    createdAt: TEST_DATE,
    displayName: "Owner",
    email: "owner@example.com",
    emailVerified: true,
    firstName: null,
    id: "account-1",
    imageUrl: null,
    lastName: null,
    mobile: null,
    nickname: null,
    preferredLanguage: null,
    status: "active",
    timeZone: null,
    type: "user",
    updatedAt: TEST_DATE,
    username: null,
    workspaceRole: role(),
  };
}

function workspaceContextOption() {
  return {
    membershipId: "membership-1",
    role: { displayName: "Workspace owner", id: "role-1", name: "workspace-owner" },
    type: "workspace",
    workspace: {
      id: "workspace-1",
      name: "Hermes dev",
      slug: "hermes-dev",
      subdomain: null,
    },
  };
}

function workspacePrincipal(
  workspace = {
    id: "workspace-1",
    name: "Hermes dev",
    slug: "hermes-dev",
    status: "active",
  },
) {
  const workspaceRole = role(workspace.id);
  return {
    account: { ...account(), workspaceRole },
    context: { membershipId: "membership-1", type: "workspace", workspace },
    membership: { id: "membership-1", role: workspaceRole, status: "active" },
    permissions: [],
    principalType: "workspace",
    role: workspaceRole,
    runtimePreferences: {
      currency: "CNY",
      dateFormat: "yyyy-MM-dd",
      language: "zh-Hans",
      regionCode: "CN",
      sources: { currency: "code", dateFormat: "code", language: "code", regionCode: "code", timeZone: "code" },
      timeZone: "Asia/Hong_Kong",
    },
    workspace,
    workspaceId: workspace.id,
    workspaceRole,
  };
}
