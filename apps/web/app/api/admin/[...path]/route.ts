import { NextResponse, type NextRequest } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import {
  AuthLoginInternalResponseSchema,
  AuthLoginResponseSchema,
  RefreshSessionInternalSchema,
  RefreshSessionResponseSchema,
} from "@hermes-swarm/api-contracts/auth";
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
const REFRESH_COOKIE_NAME =
  process.env.AUTH_REFRESH_COOKIE_NAME ??
  process.env.WEB_REFRESH_COOKIE_NAME ??
  "hermes_refresh";
const REFRESH_RETRY_DELAYS_MS = [125, 400] as const;
const DEFINITIVE_REFRESH_INVALID_CODES = new Set([
  "AUTH_CREDENTIALS_CHANGED",
  "AUTH_REFRESH_SESSION_INVALID",
  "AUTH_REFRESH_TOKEN_INVALID",
]);

const PUBLIC_ADMIN_PATHS = new Set([
  "/bootstrap",
  "/auth/login",
  "/auth/workspace-context",
  "/auth/request-password",
  "/auth/reset-password",
  "/invites/accept",
  "/invites/validate",
  "/onboarding",
  "/workspace-applications",
]);

const refreshJobs = new Map<string, Promise<WebSession>>();
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

  if (
    path === "/auth/login" ||
    path === "/auth/select-context" ||
    path === "/onboarding"
  ) {
    return handleSessionStart(request, path);
  }

  if (path === "/auth/logout") {
    const session = readWebSession(request);
    if (!session) return unauthorizedResponse(true);
    const csrfError = validateCsrfRequest(request, session);
    if (csrfError) return csrfError;
    return handleLogout(request, path, session);
  }

  if (path === "/auth/refresh") {
    const session = readWebSession(request);
    if (!session) return unauthorizedResponse(true);
    const csrfError = validateCsrfRequest(request, session);
    if (csrfError) return csrfError;
    return handleRefresh(request, session);
  }

  if (isPublicAdminPath(path)) {
    return toNextResponse(await forwardToNest(request, path, request.nextUrl.search));
  }

  let session: Awaited<ReturnType<typeof getUsableWebSession>>;
  try {
    session = await getUsableWebSession(request);
  } catch (error) {
    return refreshFailureResponse(normalizeRefreshError(error));
  }
  if (!session) return unauthorizedResponse(true);

  if (path === "/auth/csrf" && request.method === "GET") {
    const response = jsonResponse({ csrfToken: session.csrfToken }, 200);
    if (session.changed) setWebSessionCookie(response, session);
    return response;
  }
  if (isMutation(request.method)) {
    const csrfError = validateCsrfRequest(request, session);
    if (csrfError) return csrfError;
  }

  if (path === "/auth/switch-context" || path === "/onboarding/resume") {
    const upstream = await forwardToNest(
      request,
      path,
      request.nextUrl.search,
      session.accessToken,
    );
    return handleSessionResponse(upstream, {
      clearSessionOnError: path !== "/onboarding/resume",
    });
  }

  let upstream = await forwardToNest(
    request.clone(),
    path,
    request.nextUrl.search,
    session.accessToken,
  );
  if (upstream.status === 401) {
    let refreshed: WebSession;
    try {
      refreshed = await refreshWebSession(session, request);
    } catch (error) {
      return refreshFailureResponse(normalizeRefreshError(error));
    }
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
  return handleSessionResponse(upstream);
}

async function handleSessionResponse(
  upstream: Response,
  options: { clearSessionOnError?: boolean } = {},
) {
  const rawDetail = await readJson(upstream);

  if (!upstream.ok) {
    const response = jsonResponse(rawDetail, upstream.status);
    if (options.clearSessionOnError !== false) clearWebSessionCookie(response);
    return response;
  }

  const parsed = AuthLoginInternalResponseSchema.safeParse(rawDetail);
  if (!parsed.success) {
    console.error(JSON.stringify({
      code: "UPSTREAM_AUTH_CONTRACT_MISMATCH",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || "response"),
    }));
    const response = jsonResponse({ message: "认证服务响应格式无效" }, 502);
    clearWebSessionCookie(response);
    return response;
  }
  const detail = parsed.data;

  if (detail.status === "context_selection_required") {
    const response = jsonResponse(detail, upstream.status);
    clearWebSessionCookie(response);
    return response;
  }

  const accessToken = getString(detail?.accessToken);
  const expiresAt = getString(detail?.expiresAt);
  const sessionId = getString(detail?.sessionId);
  const refreshToken = extractCookieValue(
    upstream.headers.get("set-cookie"),
    REFRESH_COOKIE_NAME,
  );
  if (!accessToken || !expiresAt || !sessionId || !refreshToken) {
    return jsonResponse(
      { message: "认证服务响应缺少会话信息" },
      502,
    );
  }

  const browserDetail = AuthLoginResponseSchema.safeParse({
    expiresAt: detail.expiresAt,
    sessionId: detail.sessionId,
    snapshot: detail.snapshot,
    status: detail.status,
  });
  if (!browserDetail.success) {
    console.error(JSON.stringify({
      code: "BROWSER_AUTH_CONTRACT_MISMATCH",
      issues: browserDetail.error.issues.map((issue) => issue.path.join(".") || "response"),
    }));
    return jsonResponse({ message: "认证服务响应格式无效" }, 502);
  }
  const response = jsonResponse(browserDetail.data, upstream.status);
  setWebSessionCookie(response, {
    accessToken,
    expiresAt,
    principalType:
      detail?.snapshot &&
      typeof detail.snapshot === "object" &&
      "principalType" in detail.snapshot &&
      detail.snapshot.principalType === "platform"
        ? "platform"
        : "workspace",
    refreshToken,
    sessionId,
  });
  return response;
}

async function handleLogout(
  request: NextRequest,
  path: string,
  session: WebSession,
) {
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

async function handleRefresh(request: NextRequest, session: WebSession) {
  let refreshed: WebSession;
  try {
    refreshed = await refreshWebSession(session, request);
  } catch (error) {
    return refreshFailureResponse(normalizeRefreshError(error));
  }
  const safePayload = RefreshSessionResponseSchema.parse({
    expiresAt: refreshed.expiresAt,
    sessionId: refreshed.sessionId,
  });
  const response = jsonResponse(safePayload, 200);
  setWebSessionCookie(response, refreshed);
  return response;
}

async function getUsableWebSession(request: NextRequest) {
  const session = readWebSession(request);
  if (!session?.accessToken) return null;
  if (!isAccessTokenExpiring(session.expiresAt, ACCESS_TOKEN_REFRESH_SKEW_MS)) {
    return { ...session, changed: false };
  }
  try {
    const refreshed = await refreshWebSession(session, request);
    return { ...refreshed, changed: true };
  } catch (error) {
    if (
      error instanceof RefreshSessionError &&
      error.kind === "unavailable" &&
      !isAccessTokenExpiring(session.expiresAt)
    ) {
      return { ...session, changed: false };
    }
    throw normalizeRefreshError(error);
  }
}

function refreshWebSession(session: WebSession, request: NextRequest): Promise<WebSession> {
  const refreshJobKey = getRefreshJobKey(session);
  const existing = refreshJobs.get(refreshJobKey);
  if (existing) return existing;

  const job = refreshWebSessionUpstream(session, request).finally(() => {
    if (refreshJobs.get(refreshJobKey) === job) {
      refreshJobs.delete(refreshJobKey);
    }
  });
  refreshJobs.set(refreshJobKey, job);
  return job;
}

async function refreshWebSessionUpstream(
  session: WebSession,
  request: NextRequest,
): Promise<WebSession> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await refreshWebSessionAttempt(session, request);
    } catch (error) {
      const refreshError = normalizeRefreshError(error);
      const retryDelay = REFRESH_RETRY_DELAYS_MS[attempt];
      if (!refreshError.retryable || retryDelay === undefined) {
        throw refreshError;
      }
      await delay(retryDelay);
    }
  }
}

async function refreshWebSessionAttempt(
  session: WebSession,
  request: NextRequest,
): Promise<WebSession> {
  const refreshPath = "/auth/refresh";
  let upstream: Response;
  try {
    upstream = await fetch(`${getInternalBaseUrl()}${refreshPath}`, {
      headers: {
        cookie: `${REFRESH_COOKIE_NAME}=${encodeURIComponent(session.refreshToken)}`,
        ...(request.headers.get("user-agent")
          ? { "user-agent": request.headers.get("user-agent")! }
          : {}),
      },
      method: "POST",
    });
  } catch {
    throw new RefreshSessionError("unavailable", undefined, true);
  }
  const rawDetail = await readJson(upstream);
  if (!upstream.ok) {
    throw refreshUpstreamFailure(upstream.status, rawDetail);
  }

  const parsed = RefreshSessionInternalSchema.safeParse(rawDetail);
  if (!parsed.success) {
    console.error(JSON.stringify({
      code: "UPSTREAM_REFRESH_CONTRACT_MISMATCH",
      issues: parsed.error.issues.map((issue) => issue.path.join(".") || "response"),
    }));
    throw new RefreshSessionError("unavailable", "Refresh response contract mismatch");
  }
  const detail = parsed.data;

  const accessToken = getString(detail?.accessToken);
  const expiresAt = getString(detail?.expiresAt);
  const sessionId = getString(detail?.sessionId);
  const refreshToken =
    extractCookieValue(upstream.headers.get("set-cookie"), REFRESH_COOKIE_NAME) ??
    session.refreshToken;
  if (!accessToken || !expiresAt || !sessionId || !refreshToken) {
    throw new RefreshSessionError(
      "unavailable",
      "Refresh response is missing session fields",
    );
  }
  return {
    accessToken,
    csrfToken: session.csrfToken,
    expiresAt,
    principalType: session.principalType ?? "workspace",
    refreshToken,
    sessionId,
  };
}

function refreshUpstreamFailure(
  status: number,
  detail: Record<string, unknown> | null,
) {
  const code = getString(detail?.code);
  if (
    (status === 401 || status === 403) &&
    code !== null &&
    DEFINITIVE_REFRESH_INVALID_CODES.has(code)
  ) {
    return new RefreshSessionError(
      "invalid",
      getString(detail?.message) ?? undefined,
    );
  }
  return new RefreshSessionError(
    "unavailable",
    getString(detail?.message) ?? undefined,
    status === 401 || status === 403 || status === 429 || status >= 500,
  );
}

function isPublicAdminPath(path: string) {
  return (
    PUBLIC_ADMIN_PATHS.has(path) ||
    /^\/workspace-applications\/[^/]+\/(?:verify|cancel)$/.test(path)
  );
}

async function forwardToNest(
  request: Request,
  path: string,
  search: string,
  accessToken?: string,
) {
  const originalHost = new URL(request.url).host;
  const headers = buildForwardHeaders(
    request.headers,
    accessToken,
    originalHost,
  );
  const init: RequestInit = {
    headers,
    method: request.method,
    redirect: "manual",
  };
  if (!["GET", "HEAD"].includes(request.method) && request.body) {
    const body = await request.arrayBuffer();
    if (body.byteLength > 0) init.body = body;
  }
  return fetch(`${getInternalBaseUrl()}${path}${search}`, init);
}

function buildForwardHeaders(
  source: Headers,
  accessToken?: string,
  originalHost?: string,
) {
  const headers = new Headers();
  for (const [key, value] of source.entries()) {
    const normalized = key.toLowerCase();
    if (
      normalized === "authorization" ||
      normalized === "connection" ||
      normalized === "content-length" ||
      normalized === "cookie" ||
      normalized === "host" ||
      normalized === "x-csrf-token" ||
      normalized === "x-forwarded-host" ||
      normalized === "x-forwarded-proto" ||
      normalized === "x-scope-level" ||
      normalized === "x-workspace-id" ||
      normalized === "set-cookie" ||
      normalized === "transfer-encoding"
    ) {
      continue;
    }
    headers.set(key, value);
  }
  if (originalHost) headers.set("X-Forwarded-Host", originalHost);
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }
  return headers;
}

function isMutation(method: string) {
  return ["DELETE", "PATCH", "POST", "PUT"].includes(method.toUpperCase());
}

function validateCsrfRequest(request: NextRequest, session: WebSession) {
  const origin = request.headers.get("origin");
  if (origin) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return csrfDenied(request, "CSRF_ORIGIN_INVALID");
    }
    if (parsed.origin !== request.nextUrl.origin) {
      return csrfDenied(request, "CSRF_ORIGIN_MISMATCH");
    }
  } else if (request.headers.get("sec-fetch-site") !== "same-origin") {
    return csrfDenied(request, "CSRF_SOURCE_UNTRUSTED");
  }
  const supplied = request.headers.get("x-csrf-token") ?? "";
  const expected = session.csrfToken ?? "";
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (
    suppliedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(suppliedBuffer, expectedBuffer)
  ) {
    return csrfDenied(request, "CSRF_TOKEN_INVALID");
  }
  return null;
}

function csrfDenied(request: NextRequest, code: string) {
  console.warn(
    JSON.stringify({
      code,
      event: "csrf.denied",
      method: request.method,
      path: request.nextUrl.pathname,
    }),
  );
  return jsonResponse(
    { code, message: "请求来源验证失败", statusCode: 403 },
    403,
  );
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

function refreshFailureResponse(error: RefreshSessionError) {
  if (error.kind === "invalid") {
    return unauthorizedResponse(true);
  }
  return jsonResponse(
    { message: "认证服务暂时不可用，请稍后重试" },
    503,
  );
}

function normalizeRefreshError(error: unknown) {
  return error instanceof RefreshSessionError
    ? error
    : new RefreshSessionError("unavailable");
}

class RefreshSessionError extends Error {
  constructor(
    readonly kind: "invalid" | "unavailable",
    message =
      kind === "invalid"
        ? "登录已失效，请重新登录"
        : "认证服务暂时不可用，请稍后重试",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "RefreshSessionError";
  }
}

function getRefreshJobKey(session: WebSession) {
  return `${session.sessionId}:${createHash("sha256")
    .update(session.refreshToken)
    .digest("base64url")}`;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
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
