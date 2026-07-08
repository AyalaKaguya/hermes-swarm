import { NextResponse, type NextRequest } from "next/server";
import {
  clearWebSessionCookie,
  readWebSession,
  setWebSessionCookie,
  type WebSession,
} from "@/lib/server/web-session";

export const runtime = "nodejs";

const ACCESS_TOKEN_REFRESH_SKEW_MS = 60_000;
const INTERNAL_ADMIN_API_BASE_URL =
  process.env.API_INTERNAL_BASE_URL ?? "http://localhost:3200/api/admin";

const PUBLIC_ADMIN_PATHS = new Set([
  "/bootstrap",
  "/auth/login",
  "/auth/request-password",
  "/auth/reset-password",
  "/invites/accept",
  "/invites/validate",
  "/onboarding",
]);

type HandlerContext = {
  params: Promise<{ path?: string[] }>;
};

export async function GET(request: NextRequest, context: HandlerContext) {
  return handleAdminRequest(request, context);
}

export async function POST(request: NextRequest, context: HandlerContext) {
  return handleAdminRequest(request, context);
}

export async function PUT(request: NextRequest, context: HandlerContext) {
  return handleAdminRequest(request, context);
}

export async function PATCH(request: NextRequest, context: HandlerContext) {
  return handleAdminRequest(request, context);
}

export async function DELETE(request: NextRequest, context: HandlerContext) {
  return handleAdminRequest(request, context);
}

async function handleAdminRequest(
  request: NextRequest,
  context: HandlerContext,
) {
  const params = await context.params;
  const path = `/${params.path?.join("/") ?? ""}`;

  if (path === "/auth/login" || path === "/onboarding") {
    return handleSessionStart(request, path);
  }

  if (path === "/auth/logout") {
    return handleLogout(request, path);
  }

  if (path === "/auth/refresh") {
    return handleRefresh(request);
  }

  if (PUBLIC_ADMIN_PATHS.has(path)) {
    return toNextResponse(await forwardToNest(request, path, request.nextUrl.search));
  }

  const session = await getUsableWebSession(request);
  if (!session) return unauthorizedResponse(true);

  let upstream = await forwardToNest(
    request.clone(),
    path,
    request.nextUrl.search,
    session.accessToken,
  );
  if (upstream.status === 401) {
    const refreshed = await refreshWebSession(session, request).catch(() => null);
    if (!refreshed) return unauthorizedResponse(true);
    upstream = await forwardToNest(
      request,
      path,
      request.nextUrl.search,
      refreshed.accessToken,
    );
    return toNextResponse(upstream, refreshed);
  }

  return toNextResponse(upstream, session.changed ? session : undefined);
}

async function handleSessionStart(request: NextRequest, path: string) {
  const upstream = await forwardToNest(request, path, request.nextUrl.search);
  const detail = await readJson(upstream);

  if (!upstream.ok) {
    const response = jsonResponse(detail, upstream.status);
    clearWebSessionCookie(response);
    return response;
  }

  const accessToken = getString(detail?.accessToken);
  const expiresAt = getString(detail?.expiresAt);
  const sessionId = getString(detail?.sessionId);
  const refreshToken = extractCookieValue(
    upstream.headers.get("set-cookie"),
    "hermes_refresh",
  );
  if (!accessToken || !expiresAt || !sessionId || !refreshToken) {
    return jsonResponse(
      { message: "认证服务响应缺少会话信息" },
      502,
    );
  }

  const response = jsonResponse(stripSessionSecrets(detail), upstream.status);
  setWebSessionCookie(response, {
    accessToken,
    expiresAt,
    refreshToken,
    sessionId,
  });
  return response;
}

async function handleLogout(request: NextRequest, path: string) {
  const session = readWebSession(request);
  if (session?.accessToken) {
    await forwardToNest(
      request,
      path,
      request.nextUrl.search,
      session.accessToken,
    ).catch(() => null);
  }
  const response = new NextResponse(null, { status: 204 });
  clearWebSessionCookie(response);
  return response;
}

async function handleRefresh(request: NextRequest) {
  const session = readWebSession(request);
  if (!session) return unauthorizedResponse(true);
  const refreshed = await refreshWebSession(session, request).catch(() => null);
  if (!refreshed) return unauthorizedResponse(true);
  const response = jsonResponse(stripSessionSecrets(refreshed), 200);
  setWebSessionCookie(response, refreshed);
  return response;
}

async function getUsableWebSession(request: NextRequest) {
  const session = readWebSession(request);
  if (!session?.accessToken) return null;
  if (!isAccessTokenExpiring(session.expiresAt, ACCESS_TOKEN_REFRESH_SKEW_MS)) {
    return { ...session, changed: false };
  }
  const refreshed = await refreshWebSession(session, request).catch(() => null);
  return refreshed ? { ...refreshed, changed: true } : null;
}

async function refreshWebSession(
  session: WebSession,
  request: NextRequest,
): Promise<WebSession> {
  const upstream = await fetch(`${getInternalBaseUrl()}/auth/refresh`, {
    headers: {
      cookie: `hermes_refresh=${encodeURIComponent(session.refreshToken)}`,
      ...(request.headers.get("user-agent")
        ? { "user-agent": request.headers.get("user-agent")! }
        : {}),
    },
    method: "POST",
  });
  const detail = await readJson(upstream);
  if (!upstream.ok) {
    throw new Error(getString(detail?.message) ?? "Unable to refresh session");
  }

  const accessToken = getString(detail?.accessToken);
  const expiresAt = getString(detail?.expiresAt);
  const sessionId = getString(detail?.sessionId);
  const refreshToken =
    extractCookieValue(upstream.headers.get("set-cookie"), "hermes_refresh") ??
    session.refreshToken;
  if (!accessToken || !expiresAt || !sessionId || !refreshToken) {
    throw new Error("Refresh response is missing session fields");
  }
  return { accessToken, expiresAt, refreshToken, sessionId };
}

async function forwardToNest(
  request: Request,
  path: string,
  search: string,
  accessToken?: string,
) {
  const headers = buildForwardHeaders(request.headers, accessToken);
  const init: RequestInit & { duplex?: "half" } = {
    headers,
    method: request.method,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = request.body;
    init.duplex = "half";
  }
  return fetch(`${getInternalBaseUrl()}${path}${search}`, init);
}

function buildForwardHeaders(source: Headers, accessToken?: string) {
  const headers = new Headers();
  for (const [key, value] of source.entries()) {
    const normalized = key.toLowerCase();
    if (
      normalized === "authorization" ||
      normalized === "connection" ||
      normalized === "content-length" ||
      normalized === "cookie" ||
      normalized === "host" ||
      normalized === "set-cookie" ||
      normalized === "transfer-encoding"
    ) {
      continue;
    }
    headers.set(key, value);
  }
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return headers;
}

async function toNextResponse(upstream: Response, session?: WebSession) {
  const headers = new Headers(upstream.headers);
  headers.delete("set-cookie");
  headers.delete("transfer-encoding");
  const response = new NextResponse(
    upstream.status === 204 || upstream.status === 304 ? null : upstream.body,
    {
      headers,
      status: upstream.status,
      statusText: upstream.statusText,
    },
  );
  if (session) setWebSessionCookie(response, session);
  return response;
}

function jsonResponse(payload: unknown, status: number) {
  return NextResponse.json(payload ?? null, { status });
}

function unauthorizedResponse(clearSession: boolean) {
  const response = jsonResponse(
    { message: "登录已失效，请重新登录" },
    401,
  );
  if (clearSession) clearWebSessionCookie(response);
  return response;
}

async function readJson(response: Response): Promise<Record<string, unknown> | null> {
  return (await response.json().catch(() => null)) as Record<string, unknown> | null;
}

function stripSessionSecrets(value: Record<string, unknown> | null) {
  if (!value) return value;
  const { accessToken: _accessToken, refreshToken: _refreshToken, ...safe } = value;
  return safe;
}

function extractCookieValue(header: string | null, name: string) {
  if (!header) return null;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = header.match(new RegExp(`(?:^|,\\s*)${escapedName}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function getString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function isAccessTokenExpiring(expiresAt: string, skewMs = 0) {
  const timestamp = Date.parse(expiresAt);
  return !Number.isFinite(timestamp) || timestamp <= Date.now() + skewMs;
}

function getInternalBaseUrl() {
  return INTERNAL_ADMIN_API_BASE_URL.replace(/\/$/, "");
}
