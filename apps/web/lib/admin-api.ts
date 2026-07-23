import { SECRET_SETTING_MASK } from "@hermes-swarm/core/settings/definitions";
import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import {
  ApiErrorSchema,
  FileUploadResponseSchema,
  adminContracts,
  findAdminContract,
  responseSchemaFor,
  type ApiContract,
  type ContractRequest,
  type ContractResponse,
} from "@hermes-swarm/api-contracts";
import type {
  LoginRequest as LoginPayload,
  AccountStatus,
  AuditActor,
  AuditLogPage,
  AuditLogQuery,
  AuditNamedReference,
  AuthenticatedLoginResponse,
  AuthLoginResponse,
  AuthRefreshResponse,
  AuthSessionDevice,
  ContextSelectionOption,
  ContextSelectionRequiredResponse,
  CreatedIntegrationToken,
  CurrentUser,
  EffectiveWorkspaceSetting,
  EmailTemplateDto,
  FileUploadResponse,
  IntegrationToken,
  IntegrationTokenCapabilities,
  IntegrationTokenPermissionOption,
  IntegrationTokenScope,
  IntegrationTokenScopeCapability,
  Invite,
  InviteStatus,
  LoginAuditLogItem,
  OnboardingPayload,
  ResumeOnboardingPayload,
  OperationAuditLogItem,
  PermissionCatalog,
  PermissionCatalogEntity,
  PermissionCatalogOperation,
  PermissionCatalogPurpose,
  PermissionCatalogScope,
  PermissionScope,
  PlatformMember,
  PlatformMemberInvitation,
  PlatformMemberPayload,
  PlatformTicket,
  PlatformPrincipalSession,
  PrincipalSession,
  PublicBootstrap,
  RealtimeTicketResponse,
  Role,
  RolePayload,
  RolePermission,
  RuntimePreferences,
  SaveSettingsPayload,
  SettingPayloadEntry,
  SettingPayloadValue,
  Snapshot,
  SmtpConfig,
  SystemSettingDto,
  Ticket,
  TicketMessage,
  TicketMessageAttachment,
  TicketStatus,
  User,
  UserNotification,
  UserNotificationKind,
  UserNotificationStatus,
  Workspace,
  WorkspaceApplication,
  WorkspaceApplicationApproval,
  WorkspaceApplicationPayload,
  WorkspaceApplicationStatus,
  WorkspaceApplicationSubmission,
  WorkspaceLoginContext,
  WorkspaceMember,
  WorkspacePrincipalSession,
} from "@hermes-swarm/api-contracts";

export type {
  LoginPayload,
  AccountStatus,
  AuditActor,
  AuditLogPage,
  AuditLogQuery,
  AuditNamedReference,
  AuthenticatedLoginResponse,
  AuthLoginResponse,
  AuthRefreshResponse,
  AuthSessionDevice,
  ContextSelectionOption,
  ContextSelectionRequiredResponse,
  CreatedIntegrationToken,
  CurrentUser,
  EffectiveWorkspaceSetting,
  EmailTemplateDto,
  FileUploadResponse,
  IntegrationToken,
  IntegrationTokenCapabilities,
  IntegrationTokenPermissionOption,
  IntegrationTokenScope,
  IntegrationTokenScopeCapability,
  Invite,
  InviteStatus,
  LoginAuditLogItem,
  OnboardingPayload,
  ResumeOnboardingPayload,
  OperationAuditLogItem,
  PermissionCatalog,
  PermissionCatalogEntity,
  PermissionCatalogOperation,
  PermissionCatalogPurpose,
  PermissionCatalogScope,
  PermissionScope,
  PlatformMember,
  PlatformMemberInvitation,
  PlatformMemberPayload,
  PlatformTicket,
  PlatformPrincipalSession,
  PrincipalSession,
  PublicBootstrap,
  RealtimeTicketResponse,
  Role,
  RolePayload,
  RolePermission,
  RuntimePreferences,
  SaveSettingsPayload,
  SettingPayloadEntry,
  SettingPayloadValue,
  Snapshot,
  SmtpConfig,
  SystemSettingDto,
  Ticket,
  TicketMessage,
  TicketMessageAttachment,
  TicketStatus,
  User,
  UserNotification,
  UserNotificationKind,
  UserNotificationStatus,
  Workspace,
  WorkspaceApplication,
  WorkspaceApplicationApproval,
  WorkspaceApplicationPayload,
  WorkspaceApplicationStatus,
  WorkspaceApplicationSubmission,
  WorkspaceLoginContext,
  WorkspaceMember,
  WorkspacePrincipalSession,
};

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

type AdminFetchOptions = {
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

export function authLogin(payload: LoginPayload) {
  return fetchAdmin(adminContracts.authLogin, {
    body: payload,
  });
}

export function selectLoginContext(payload: {
  contextType: "platform" | "workspace";
  membershipId: string;
  selectionToken: string;
}) {
  return fetchAdmin(adminContracts.authSelectContext, {
    body: payload,
  });
}

export function listAccountContexts() {
  return fetchAdmin(adminContracts.authContexts);
}

export function switchAccountContext(payload: {
  contextType: "platform" | "workspace";
  membershipId: string;
}) {
  return fetchAdmin(adminContracts.authSwitchContext, {
    body: payload,
  });
}

export function resolveWorkspaceLoginContext(workspace?: string) {
  return fetchAdmin(adminContracts.authWorkspaceContext, {
    body: workspace ? { workspace } : {},
  });
}

export function submitWorkspaceApplication(payload: WorkspaceApplicationPayload) {
  return fetchAdmin<WorkspaceApplicationSubmission>("/workspace-applications", {
    body: payload,
    method: "POST",
  });
}

export function verifyWorkspaceApplication(applicationId: string, token: string) {
  return fetchAdmin<WorkspaceApplication>(
    `/workspace-applications/${applicationId}/verify`,
    { body: { token }, method: "POST" },
  );
}

export function cancelWorkspaceApplication(applicationId: string, token: string) {
  return fetchAdmin<WorkspaceApplication>(
    `/workspace-applications/${applicationId}/cancel`,
    { body: { token }, method: "POST" },
  );
}

export function activateWorkspaceOwner(payload: {
  displayName?: string;
  password?: string;
  token: string;
}) {
  return fetchAdmin<{
    account: Pick<User, "displayName" | "email" | "id">;
    existingAccount: boolean;
    membershipId: string;
    workspace: Workspace;
  }>("/workspace-applications/activate-owner", {
    body: payload,
    method: "POST",
  });
}

export function listWorkspaceApplications(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<WorkspaceApplication[]>("/platform/workspace-applications", {});
}

export function listPlatformWorkspaces(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Workspace[]>("/platform/workspaces", {});
}

export function listLoginAuditLogs(
  session: AuthenticatedAdminSessionMarker,
  scope: "platform" | "workspace",
  query: AuditLogQuery,
) {
  return fetchAdmin<AuditLogPage<LoginAuditLogItem>>(
    `${auditApiBase(scope)}/login-logs${buildQueryString(query)}`,
  );
}

export function listOperationAuditLogs(
  session: AuthenticatedAdminSessionMarker,
  scope: "platform" | "workspace",
  query: AuditLogQuery,
) {
  return fetchAdmin<AuditLogPage<OperationAuditLogItem>>(
    `${auditApiBase(scope)}/operation-logs${buildQueryString(query)}`,
  );
}

function auditApiBase(scope: "platform" | "workspace") {
  return scope === "platform" ? "/platform/audit" : "/workspace/audit";
}

function buildQueryString(query: AuditLogQuery) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    parameters.set(key, String(value));
  }
  const queryString = parameters.toString();
  return queryString ? `?${queryString}` : "";
}

export function updatePlatformWorkspaceStatus(
  session: AuthenticatedAdminSessionMarker,
  workspaceId: string,
  status: "active" | "archived" | "suspended",
) {
  return fetchAdmin<Workspace>(`/platform/workspaces/${workspaceId}/status`, {
    body: { status },
    method: "PATCH",
  });
}

export function approveWorkspaceApplication(
  session: AuthenticatedAdminSessionMarker,
  applicationId: string,
  payload: { note?: string | null },
) {
  return fetchAdmin<WorkspaceApplicationApproval>(
    `/platform/workspace-applications/${applicationId}/approve`,
    { body: payload, method: "POST" },
  );
}

export function rejectWorkspaceApplication(
  session: AuthenticatedAdminSessionMarker,
  applicationId: string,
  payload: { note?: string | null },
) {
  return fetchAdmin<WorkspaceApplication>(
    `/platform/workspace-applications/${applicationId}/reject`,
    { body: payload, method: "POST" },
  );
}

export function onboard(payload: OnboardingPayload) {
  return fetchAdmin<AuthenticatedLoginResponse>("/onboarding", {
    body: payload,
    method: "POST",
  });
}

export function resumeOnboarding(payload: ResumeOnboardingPayload) {
  return fetchAdmin<AuthenticatedLoginResponse>("/onboarding/resume", {
    body: payload,
    method: "POST",
  });
}

export async function refreshAuthSession() {
  return fetchAdmin<AuthRefreshResponse>("/auth/refresh", {
    method: "POST",
  });
}

export async function logoutAuthSession() {
  await fetchAdmin<void>("/auth/logout", { method: "POST" }).catch(
    () => undefined,
  );
}

export function createRealtimeTicket() {
  return fetchAdmin<RealtimeTicketResponse>("/auth/realtime-ticket", {
    method: "POST",
  });
}

export function requestPasswordReset(email: string, workspaceSlug?: string) {
  return fetchAdmin<{ success: boolean }>("/auth/request-password", {
    body: { email, workspaceSlug },
    method: "POST",
  });
}

export function resetPassword(payload: {
  confirmPassword?: string;
  email?: string;
  password?: string;
  token?: string;
}) {
  return fetchAdmin<{ success: boolean }>("/auth/reset-password", {
    body: payload,
    method: "POST",
  });
}

export function listAuthSessions(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<AuthSessionDevice[]>("/auth/sessions", {});
}

export function revokeAuthSession(session: AuthenticatedAdminSessionMarker, sessionId: string) {
  return fetchAdmin<void>(`/auth/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function deleteAuthSessionRecord(session: AuthenticatedAdminSessionMarker, sessionId: string) {
  return fetchAdmin<void>(`/auth/sessions/${sessionId}/record`, {
    method: "DELETE",
  });
}

export function revokeOtherAuthSessions(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<void>("/auth/sessions", {
    method: "DELETE",
  });
}

export function getIntegrationTokenCapabilities(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<IntegrationTokenCapabilities>(
    "/account/integration-tokens/capabilities",
    {},
  );
}

export function listIntegrationTokens(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<IntegrationToken[]>(
    "/account/integration-tokens",
    {},
  );
}

export function createIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    expiresAt?: string;
    note?: string | null;
    permissions: string[];
  },
) {
  return fetchAdmin<CreatedIntegrationToken>(
    "/account/integration-tokens",
    { body: payload, method: "POST" },
  );
}

export function revokeIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  integrationTokenId: string,
) {
  return fetchAdmin<void>(
    `/account/integration-tokens/${integrationTokenId}`,
    { method: "DELETE" },
  );
}

export function validateInvite(email: string | null | undefined, token: string) {
  return fetchAdmin<Invite>("/invites/validate", {
    body: { email, token },
    method: "POST",
  });
}

export function acceptInvite(payload: {
  action?: "accept" | "decline";
  displayName?: string;
  email?: string;
  password?: string;
  token?: string;
}) {
  return fetchAdmin<Invite>("/invites/accept", {
    body: payload,
    method: "POST",
  });
}

export function fetchMe(session?: AuthenticatedAdminSessionMarker) {
  return fetchAdmin(adminContracts.authMe);
}

export function searchUsers(session: AuthenticatedAdminSessionMarker, search: string) {
  const suffix = search.trim()
    ? `?search=${encodeURIComponent(search.trim())}`
    : "";
  return fetchAdmin<WorkspaceMember[]>(`/workspace/members/search${suffix}`, {});
}

export function fetchAccount() {
  return fetchAdmin<User>("/account");
}

export function updateUser(session: AuthenticatedAdminSessionMarker, payload: {
  displayName?: string;
  email?: string;
  firstName?: string | null;
  imageUrl?: string | null;
  lastName?: string | null;
  mobile?: string | null;
  username?: string | null;
}) {
  return fetchAdmin<User>("/account", { body: payload, method: "PATCH" });
}

export function updateUserPassword(session: AuthenticatedAdminSessionMarker, payload: {
  currentPassword: string;
  password: string;
}) {
  return fetchAdmin<void>("/account/password", { body: payload, method: "PATCH" });
}

export function updateUserPreferredLanguage(
  session: AuthenticatedAdminSessionMarker,
  preferredLanguage: string | null,
) {
  return fetchAdmin<User>("/account/preferences", {
    body: { preferredLanguage },
    method: "PATCH",
  });
}

export function updateUserRuntimePreferences(
  session: AuthenticatedAdminSessionMarker,
  payload: { preferredLanguage?: string | null; timeZone?: string | null },
) {
  return fetchAdmin<User>("/account/preferences", {
    body: payload,
    method: "PATCH",
  });
}

export function getSmtpConfig(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<SmtpConfig | null>("/workspace/mail/smtp", {});
}

export function saveSmtpConfig(session: AuthenticatedAdminSessionMarker, payload: {
  fromAddress?: string | null;
  host?: string;
  isValidated?: boolean;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}) {
  return fetchAdmin<SmtpConfig>("/workspace/mail/smtp", { body: payload, method: "PUT" });
}

export function validateSmtpConfig(session: AuthenticatedAdminSessionMarker, payload: {
  fromAddress?: string | null;
  host?: string;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}) {
  return fetchAdmin<{ ok: boolean }>("/workspace/mail/smtp/validate", { body: payload, method: "POST" });
}

export function getPlatformSmtpConfig(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<SmtpConfig | null>("/platform/mail/smtp", {});
}

export function savePlatformSmtpConfig(session: AuthenticatedAdminSessionMarker, payload: {
  fromAddress?: string | null;
  host?: string;
  isValidated?: boolean;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}) {
  return fetchAdmin<SmtpConfig>("/platform/mail/smtp", {
    body: payload,
    method: "PATCH",
  });
}

export function validatePlatformSmtpConfig(session: AuthenticatedAdminSessionMarker, payload: {
  fromAddress?: string | null;
  host?: string;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}) {
  return fetchAdmin<{ ok: boolean }>("/platform/mail/smtp/validate", {
    body: payload,
    method: "POST",
  });
}

export function listWorkspaceMembers(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<WorkspaceMember[]>("/workspace/members", {});
}

export function updateWorkspaceMemberStatus(
  session: AuthenticatedAdminSessionMarker,
  membershipId: string,
  status: WorkspaceMember["status"],
  roleId?: string,
) {
  return fetchAdmin<WorkspaceMember>(
    `/workspace/members/${membershipId}/status`,
    { body: { roleId, status }, method: "PATCH" },
  );
}

export function removeWorkspaceMember(
  session: AuthenticatedAdminSessionMarker,
  membershipId: string,
) {
  return fetchAdmin<void>(`/workspace/members/${membershipId}`, {
    method: "DELETE",
  });
}

export function replaceWorkspaceMemberRole(
  session: AuthenticatedAdminSessionMarker,
  membershipId: string,
  roleId: string,
) {
  return fetchAdmin<WorkspaceMember>(`/workspace/members/${membershipId}/role`, {
    body: { roleId },
    method: "PUT",
  });
}

export function listInvites(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Invite[]>("/invites", {});
}

export function createInvite(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    email: string;
    expiresIn?: "3d" | "7d" | "never";
    workspaceRoleId: string;
  },
) {
  return fetchAdmin<Invite>("/invites", {
    body: payload,
    method: "POST",
  });
}

export function resendInvite(
  session: AuthenticatedAdminSessionMarker,
  inviteId: string,
) {
  return fetchAdmin<Invite>(`/invites/${inviteId}/resend`, {
    method: "POST",
  });
}

export function revokeInvite(
  session: AuthenticatedAdminSessionMarker,
  inviteId: string,
) {
  return fetchAdmin<void>(`/invites/${inviteId}`, { method: "DELETE" });
}

export function listEmailTemplates(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<EmailTemplateDto[]>("/workspace/mail/templates", {});
}

export function createEmailTemplate(session: AuthenticatedAdminSessionMarker, payload: {
  description?: string | null;
  hbs: string;
  languageCode: string;
  mjml?: string | null;
  name: string;
  subject?: string | null;
}) {
  return fetchAdmin<EmailTemplateDto>("/workspace/mail/templates", { body: payload, method: "POST" });
}

export function updateEmailTemplate(session: AuthenticatedAdminSessionMarker, templateId: string, payload: Partial<{
  description: string | null;
  hbs: string;
  languageCode: string;
  mjml: string | null;
  name: string;
  subject: string | null;
}>) {
  return fetchAdmin<EmailTemplateDto>(`/workspace/mail/templates/${templateId}`, { body: payload, method: "PATCH" });
}

export function deleteEmailTemplate(session: AuthenticatedAdminSessionMarker, templateId: string) {
  return fetchAdmin<void>(`/workspace/mail/templates/${templateId}`, { method: "DELETE" });
}

export function previewEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  payload: { hbs: string; subject?: string | null },
  scope: "platform" | "workspace" = "workspace",
) {
  const path = scope === "platform"
    ? "/platform/mail/templates/preview"
    : "/workspace/mail/templates/preview";
  return fetchAdmin<{ html: string; subject: string }>(path, {
    body: payload,
    method: "POST",
  });
}

export function listPlatformEmailTemplates(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<EmailTemplateDto[]>("/platform/mail/templates", {});
}

export function createPlatformEmailTemplate(session: AuthenticatedAdminSessionMarker, payload: {
  description?: string | null;
  hbs?: string;
  languageCode?: string;
  mjml?: string | null;
  name?: string;
  subject?: string | null;
}) {
  return fetchAdmin<EmailTemplateDto>("/platform/mail/templates", {
    body: payload,
    method: "POST",
  });
}

export function updatePlatformEmailTemplate(session: AuthenticatedAdminSessionMarker, templateId: string, payload: Partial<{
  description: string | null;
  hbs: string;
  languageCode: string;
  mjml: string | null;
  name: string;
  subject: string | null;
}>) {
  return fetchAdmin<EmailTemplateDto>(
    `/platform/mail/templates/${templateId}`,
    { body: payload, method: "PATCH" },
  );
}

export function deletePlatformEmailTemplate(session: AuthenticatedAdminSessionMarker, templateId: string) {
  return fetchAdmin<void>(`/platform/mail/templates/${templateId}`, {
    method: "DELETE",
  });
}

export function listSystemSettings(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<SystemSettingDto[]>("/platform/settings", {});
}

export function saveSystemSettings(
  session: AuthenticatedAdminSessionMarker,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<SystemSettingDto[]>("/platform/settings", { body: settings, method: "PUT" });
}

export function listWorkspaceSettings(
  session: AuthenticatedAdminSessionMarker,
) {
  return fetchAdmin<EffectiveWorkspaceSetting[]>("/workspace/settings", {});
}

export function saveWorkspaceSettings(
  session: AuthenticatedAdminSessionMarker,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<EffectiveWorkspaceSetting[]>("/workspace/settings", {
    body: settings,
    method: "PUT",
  });
}

export function updateWorkspace(
  session: AuthenticatedAdminSessionMarker,
  payload: Partial<Pick<Workspace, "name">>,
) {
  return fetchAdmin<Workspace>("/workspace", {
    body: payload,
    method: "PATCH",
  });
}

export function listWorkspaceRoles(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Role[]>("/workspace/roles", {});
}

export function createWorkspaceRole(
  session: AuthenticatedAdminSessionMarker,
  payload: RolePayload,
) {
  return fetchAdmin<Role>("/workspace/roles", {
    body: payload,
    method: "POST",
  });
}

export function updateWorkspaceRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/workspace/roles/${roleId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function replaceWorkspaceRolePermissions(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  permissions: Array<{ enabled?: boolean; permission?: string }>,
) {
  return fetchAdmin<Role>(`/workspace/roles/${roleId}/permissions`, {
    body: { permissions },
    method: "PUT",
  });
}

export function deleteWorkspaceRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
) {
  return fetchAdmin<{ success: boolean }>(`/workspace/roles/${roleId}`, {
    method: "DELETE",
  });
}

export function listPermissionCatalog(
  session: AuthenticatedAdminSessionMarker,
) {
  void session;
  return fetchAdmin<PermissionCatalog>("/workspace/permissions/catalog", {
  });
}

export function listPlatformPermissionCatalog(
  session: AuthenticatedAdminSessionMarker,
) {
  void session;
  return fetchAdmin<PermissionCatalog>("/platform/permissions/catalog", {});
}

export function listPlatformMembers(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<PlatformMember[]>("/platform/members", {});
}

export function createPlatformMember(session: AuthenticatedAdminSessionMarker, payload: PlatformMemberPayload) {
  return fetchAdmin<PlatformMember | PlatformMemberInvitation>("/platform/members", {
    body: payload,
    method: "POST",
  });
}

export function updatePlatformMember(
  session: AuthenticatedAdminSessionMarker,
  memberId: string,
  payload: PlatformMemberPayload,
) {
  return fetchAdmin<PlatformMember>(`/platform/members/${memberId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function deletePlatformMember(session: AuthenticatedAdminSessionMarker, memberId: string) {
  return fetchAdmin<void>(`/platform/members/${memberId}`, {
    method: "DELETE",
  });
}

export function listPlatformRoles(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Role[]>("/platform/roles", {});
}

export function createPlatformRole(session: AuthenticatedAdminSessionMarker, payload: RolePayload) {
  return fetchAdmin<Role>("/platform/roles", {
    body: payload,
    method: "POST",
  });
}

export function updatePlatformRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/platform/roles/${roleId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function replacePlatformRolePermissions(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  permissions: Array<{ enabled?: boolean; permission?: string }>,
) {
  return fetchAdmin<RolePermission[]>(`/platform/roles/${roleId}/permissions`, {
    body: { permissions },
    method: "PUT",
  });
}

export function deletePlatformRole(session: AuthenticatedAdminSessionMarker, roleId: string) {
  return fetchAdmin<void>(`/platform/roles/${roleId}`, {
    method: "DELETE",
  });
}

export function listUserNotifications(
  session: AuthenticatedAdminSessionMarker,
  options: { status?: UserNotificationStatus; take?: number } = {},
) {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  if (options.take) params.set("take", String(options.take));
  const query = params.toString();
  const suffix = query ? `?${query}` : "";
  return fetchAdmin<UserNotification[]>(`/notifications${suffix}`, {});
}

export function getUnreadNotificationCount(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<{ count: number }>("/notifications/unread-count", {});
}

export function markNotificationRead(session: AuthenticatedAdminSessionMarker, notificationId: string) {
  return fetchAdmin<UserNotification>(`/notifications/${notificationId}/read`, {
    method: "PATCH",
  });
}

export function markAllNotificationsRead(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<{ ok: boolean }>("/notifications/read", {
    method: "PATCH",
  });
}

export function dismissReadNotifications(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<{ ok: boolean }>("/notifications/read", {
    method: "DELETE",
  });
}

export function dismissNotification(session: AuthenticatedAdminSessionMarker, notificationId: string) {
  return fetchAdmin<void>(`/notifications/${notificationId}`, {
    method: "DELETE",
  });
}

export function sendUserNotification(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    body?: string | null;
    kind?: UserNotificationKind;
    payload?: Record<string, unknown> | null;
    recipientUserIds: string[];
    title: string;
  },
) {
  return fetchAdmin<UserNotification[]>("/notifications", {
    body: payload,
    method: "POST",
  });
}

export function listTickets(
  session: AuthenticatedAdminSessionMarker,
  options: { status?: TicketStatus } = {},
) {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  const query = params.toString();
  return fetchAdmin<Ticket[]>(`/tickets${query ? `?${query}` : ""}`, {});
}

export function listPlatformTickets(
  session: AuthenticatedAdminSessionMarker,
  options: { status?: TicketStatus } = {},
) {
  const params = new URLSearchParams();
  if (options.status) params.set("status", options.status);
  const query = params.toString();
  return fetchAdmin<PlatformTicket[]>(
    `/platform/tickets${query ? `?${query}` : ""}`,
    {},
  );
}

export function getPlatformTicket(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
) {
  return fetchAdmin<PlatformTicket>(`/platform/tickets/${ticketId}`, {});
}

export function listPlatformTicketMessages(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
) {
  return fetchAdmin<TicketMessage[]>(`/platform/tickets/${ticketId}/messages`, {});
}

export function sendPlatformTicketMessage(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
  payload: { attachments?: TicketMessageAttachment[] | null; body: string },
) {
  return fetchAdmin<TicketMessage>(`/platform/tickets/${ticketId}/messages`, {
    body: payload,
    method: "POST",
  });
}

export function closePlatformTicket(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
) {
  return fetchAdmin<PlatformTicket>(`/platform/tickets/${ticketId}/close`, {
    method: "PATCH",
  });
}

export function markPlatformTicketRead(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
) {
  return fetchAdmin<{ ok: boolean }>(`/platform/tickets/${ticketId}/read`, {
    method: "PATCH",
  });
}

export function createTicket(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    attachments?: TicketMessageAttachment[] | null;
    body: string;
    subject: string;
  },
) {
  return fetchAdmin<Ticket & { firstMessage: TicketMessage }>(
    "/tickets",
    { body: payload, method: "POST" },
  );
}

export function getTicket(session: AuthenticatedAdminSessionMarker, ticketId: string) {
  return fetchAdmin<Ticket>(`/tickets/${ticketId}`, {});
}

export function listTicketMessages(session: AuthenticatedAdminSessionMarker, ticketId: string) {
  return fetchAdmin<TicketMessage[]>(`/tickets/${ticketId}/messages`, {});
}

export function sendTicketMessage(
  session: AuthenticatedAdminSessionMarker,
  ticketId: string,
  payload: { attachments?: TicketMessageAttachment[] | null; body: string },
) {
  return fetchAdmin<TicketMessage>(`/tickets/${ticketId}/messages`, {
    body: payload,
    method: "POST",
  });
}

export function closeTicket(session: AuthenticatedAdminSessionMarker, ticketId: string) {
  return fetchAdmin<Ticket>(`/tickets/${ticketId}/close`, {
    method: "PATCH",
  });
}

export function markTicketRead(session: AuthenticatedAdminSessionMarker, ticketId: string) {
  return fetchAdmin<{ ok: boolean }>(`/tickets/${ticketId}/read`, {
    method: "PATCH",
  });
}
