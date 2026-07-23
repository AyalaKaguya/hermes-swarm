import { SECRET_SETTING_MASK } from "@hermes-swarm/core/settings/definitions";
import {
  ApiErrorSchema,
  FileUploadResponseSchema,
  findAdminContract,
  responseSchemaFor,
  type ApiContract,
  type ContractRequest,
  type ContractResponse,
} from "@hermes-swarm/api-contracts";
import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import type { PublicBootstrap } from "@hermes-swarm/api-contracts";

const API_BASE_URL = "/api";
const ADMIN_API_BASE_URL = "/api/admin";
const configuredRequestTimeoutMs = Number(
  process.env.NEXT_PUBLIC_ADMIN_API_TIMEOUT_MS,
);
const REQUEST_TIMEOUT_MS =
  Number.isFinite(configuredRequestTimeoutMs) && configuredRequestTimeoutMs >= 1_000
    ? configuredRequestTimeoutMs
    : 30_000;

export class AdminApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AdminApiError";
  }
}

export class AdminContractError extends Error {
  constructor(
    public readonly contractId: string,
    public readonly phase: "request" | "response",
    public readonly issues: string[],
  ) {
    super("API 数据格式与应用契约不一致");
    this.name = "AdminContractError";
  }
}

export function isUnauthorizedApiError(error: unknown) {
  return error instanceof AdminApiError && error.status === 401;
}

export function getRealtimeUrl(ticket: string) {
  const baseUrl = `${window.location.origin}${API_BASE_URL}`;
  const url = new URL(`${baseUrl.replace(/\/$/, "")}/realtime`);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("ticket", ticket);
  return url.toString();
}

export type AdminFetchOptions = {
  body?: unknown;
  cache?: RequestCache;
  method?: string;
  params?: Record<string, string>;
  query?: Record<string, boolean | number | string | null | undefined>;
};

export function fetchAdmin<C extends ApiContract>(
  contract: C,
  options?: ContractRequest<C>,
): Promise<ContractResponse<C>>;
export function fetchAdmin<T>(
  path: string,
  options?: AdminFetchOptions,
): Promise<T>;
export async function fetchAdmin(
  contractOrPath: ApiContract | string,
  options?: AdminFetchOptions,
): Promise<unknown> {
  const path = typeof contractOrPath === "string"
    ? contractOrPath
    : buildContractPath(contractOrPath.path, options?.params, options?.query);
  const method = typeof contractOrPath === "string"
    ? options?.method ?? "GET"
    : contractOrPath.method;
  const match = typeof contractOrPath === "string"
    ? findAdminContract(method, path)
    : { contract: contractOrPath, params: options?.params ?? {} };
  if (match) validateContractRequest(match.contract, path, match.params, options?.body);
  const response = await sendAdminRequest(path, { ...options, method });
  return parseAdminResponse(response, match?.contract);
}

async function sendAdminRequest(
  path: string,
  options?: {
    body?: unknown;
    cache?: RequestCache;
    method?: string;
  },
) {
  const body = options?.body;
  const isMultipart = body instanceof FormData;
  const headers = new Headers();
  if (body !== undefined && !isMultipart) {
    headers.set("Content-Type", "application/json");
  }
  const method = options?.method ?? "GET";
  if (
    ["DELETE", "PATCH", "POST", "PUT"].includes(method.toUpperCase()) &&
    shouldAttachCsrfToken(path)
  ) {
    headers.set("X-CSRF-Token", await getCsrfToken());
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
      cache: options?.cache,
      method,
      headers,
      body:
        body === undefined
          ? undefined
          : body instanceof FormData
            ? body
            : JSON.stringify(body),
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，请确认 API 服务已启动");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }

  return response;
}

let csrfTokenPromise: Promise<string> | null = null;
const CSRF_EXEMPT_ADMIN_PATHS = new Set([
  "/bootstrap",
  "/auth/login",
  "/auth/select-context",
  "/auth/workspace-context",
  "/auth/request-password",
  "/auth/reset-password",
  "/invites/accept",
  "/invites/validate",
  "/onboarding",
  "/workspace-applications",
  "/workspace-applications/activate-owner",
]);

async function getCsrfToken() {
  csrfTokenPromise ??= fetch(`${ADMIN_API_BASE_URL}/auth/csrf`, {
    credentials: "include",
  }).then(async (response) => {
    if (!response.ok) throw new Error("无法建立安全请求上下文");
    const value = (await response.json()) as { csrfToken?: unknown };
    if (typeof value.csrfToken !== "string" || !value.csrfToken) {
      throw new Error("安全请求上下文无效");
    }
    return value.csrfToken;
  });
  try {
    return await csrfTokenPromise;
  } catch (error) {
    csrfTokenPromise = null;
    throw error;
  }
}

function shouldAttachCsrfToken(path: string) {
  const pathname = path.split("?", 1)[0] ?? path;
  if (CSRF_EXEMPT_ADMIN_PATHS.has(pathname)) return false;
  return !/^\/workspace-applications\/[^/]+\/(?:verify|cancel)$/.test(pathname);
}

async function parseAdminResponse<T>(response: Response, contract?: ApiContract): Promise<T> {
  if (!response.ok) {
    const detail = await response.json().catch(() => undefined);
    const parsedError = ApiErrorSchema.safeParse(detail);
    const message = parsedError.success
      ? Array.isArray(parsedError.data.message)
        ? parsedError.data.message.join(", ")
        : parsedError.data.message
      : undefined;
    throw new AdminApiError(
      message || `请求失败：${response.status}`,
      response.status,
      parsedError.success ? parsedError.data.code : undefined,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return null as T;
  }

  const value = maskSecretSettingPayload(JSON.parse(text));
  if (!contract) return value as T;
  const schema = responseSchemaFor(contract, response.status, true);
  if (!schema) return value as T;
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new AdminContractError(
      contract.id,
      "response",
      result.error.issues.map((issue) => issue.path.join(".") || "response"),
    );
  }
  return result.data as T;
}

function validateContractRequest(
  contract: ApiContract,
  path: string,
  params: Record<string, unknown>,
  body: unknown,
) {
  const query = Object.fromEntries(new URLSearchParams(path.split("?", 2)[1] ?? ""));
  for (const [source, schema, value] of [
    ["params", contract.params, params],
    ["query", contract.query, query],
    ["body", contract.body, body],
  ] as const) {
    if (!schema || contract.multipart) continue;
    const result = schema.safeParse(value);
    if (!result.success) {
      throw new AdminContractError(
        contract.id,
        "request",
        result.error.issues.map((issue) => `${source}.${issue.path.join(".")}`),
      );
    }
  }
}

function buildContractPath(
  template: string,
  params: Record<string, string> = {},
  query: Record<string, boolean | number | string | null | undefined> = {},
) {
  const path = template.replace(/:([^/]+)/g, (_match, name: string) => {
    const value = params[name];
    if (!value) throw new AdminContractError("path", "request", [`params.${name}`]);
    return encodeURIComponent(value);
  });
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  return search.size ? `${path}?${search}` : path;
}

function maskSecretSettingPayload(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(maskSecretSettingPayload);
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const item = value as Record<string, unknown>;
  for (const [key, child] of Object.entries(item)) {
    item[key] = maskSecretSettingPayload(child);
  }

  if (item.valueType === "secret") {
    if (item.value !== null && item.value !== undefined) {
      item.value = SECRET_SETTING_MASK;
    }
    if (item.defaultValue !== null && item.defaultValue !== undefined) {
      item.defaultValue = SECRET_SETTING_MASK;
    }
    if (item.overrideValue !== null && item.overrideValue !== undefined) {
      item.overrideValue = SECRET_SETTING_MASK;
    }
  }

  return item;
}

export async function uploadAdminFile(session: AuthenticatedAdminSessionMarker, file: File) {
  return uploadFile(session, "/files/upload", "files.upload", file);
}

export async function uploadPlatformFile(
  session: AuthenticatedAdminSessionMarker,
  file: File,
) {
  return uploadFile(session, "/files/platform/upload", "platform.files.upload", file);
}

async function uploadFile(
  _session: AuthenticatedAdminSessionMarker,
  path: string,
  contractId: string,
  file: File,
) {
  const body = new FormData();
  body.append("file", file);

  const response = await sendAdminRequest(path, {
    body,
    method: "POST",
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => undefined);
    const message = Array.isArray(detail?.message)
      ? detail.message.join(", ")
      : detail?.message;
    throw new Error(message || `请求失败：${response.status}`);
  }

  const payload = await response.json();
  const result = FileUploadResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new AdminContractError(
      contractId,
      "response",
      result.error.issues.map((issue) => issue.path.join(".") || "response"),
    );
  }
  return result.data;
}

const PUBLIC_BOOTSTRAP_RETRY_DELAYS_MS = [250, 750] as const;

export async function getPublicBootstrap(): Promise<PublicBootstrap> {
  for (let attempt = 0; attempt <= PUBLIC_BOOTSTRAP_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await fetchAdmin<PublicBootstrap>("/bootstrap", {
        cache: "no-store",
      });
    } catch (error) {
      const retryDelay = PUBLIC_BOOTSTRAP_RETRY_DELAYS_MS[attempt];
      if (retryDelay === undefined || !isRetriablePublicBootstrapError(error)) {
        throw error;
      }
      await waitForPublicBootstrapRetry(retryDelay);
    }
  }

  throw new Error("无法加载平台初始化状态");
}

function isRetriablePublicBootstrapError(error: unknown) {
  if (error instanceof AdminApiError) {
    return error.status >= 500 && error.status < 600;
  }
  return error instanceof TypeError || (
    error instanceof Error && error.message.startsWith("请求超时")
  );
}

function waitForPublicBootstrapRetry(delayMs: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  });
}
