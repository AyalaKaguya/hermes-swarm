import {
  SECRET_SETTING_MASK,
  type SettingValueOption,
  type SettingValueType,
} from "@hermes-swarm/core/settings/definitions";
import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import { getOrganizationRequestSignal } from "@/lib/organization-context";


export type OrganizationStatus = "active" | "suspended";
export type UserStatus = "active" | "disabled";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: "provisioning" | "active" | "suspended" | "archived";
};

export type TenantApplicationStatus =
  | "pending_email_verification"
  | "pending_review"
  | "approved"
  | "rejected"
  | "cancelled";

export type TenantApplication = {
  createdAt: string;
  emailVerifiedAt: string | null;
  id: string;
  ownerDisplayName: string;
  ownerEmail: string;
  requestedName: string;
  requestedSlug: string;
  requestedSubdomain: string | null;
  reviewedAt: string | null;
  reviewedByPlatformUserId: string | null;
  reviewNote: string | null;
  status: TenantApplicationStatus;
  tenantId: string | null;
  updatedAt: string;
};

export type TenantApplicationPayload = {
  ownerDisplayName: string;
  ownerEmail: string;
  requestedName: string;
  requestedSlug: string;
  requestedSubdomain?: string | null;
};

export type TenantApplicationSubmission = {
  applicationId: string;
  cancellationToken?: string;
  verificationToken?: string;
};

export type TenantApplicationApproval = {
  application: TenantApplication;
  ownerActivationToken?: string;
  ownerUser: User;
  tenant: Tenant;
};

export type Organization = {
  createdAt?: string;
  createdByUserId?: string | null;
  id: string;
  name: string;
  parentOrganizationId: string | null;
  slug: string;
  status: OrganizationStatus;
  updatedAt?: string;
};

export type OrganizationPayload = Partial<{
  name: string;
  parentOrganizationId: string | null;
  slug: string;
  status: OrganizationStatus;
}>;

export type UserNotificationStatus = "read" | "unread";
export type UserNotificationKind = "error" | "info" | "success" | "warning";

export type UserNotification = {
  actorUserId: string | null;
  body: string | null;
  createdAt: string;
  dismissedAt: string | null;
  id: string;
  kind: UserNotificationKind;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  sourceId: string | null;
  sourceType: string | null;
  status: UserNotificationStatus;
  title: string;
  updatedAt: string;
};

export type TicketStatus = "archived" | "closed" | "open";
export type Ticket = {
  archivedAt: string | null;
  assigneeUserId: string | null;
  conversationId: string | null;
  createdAt: string;
  handlerClosedAt: string | null;
  id: string;
  lastMessageAt: string | null;
  participantUserIds: string[];
  requesterClosedAt: string | null;
  requesterUserId: string;
  sourceOrganization?: Pick<Organization, "id" | "name" | "slug">;
  sourceOrganizationId: string;
  status: TicketStatus;
  subject: string;
  updatedAt: string;
};

export type TicketMessageAttachment = {
  mimeType?: string;
  name: string;
  size?: number;
  type: "image";
  url: string;
};

export type TicketMessage = {
  attachments: TicketMessageAttachment[];
  author: {
    avatarUrl?: string | null;
    displayName: string;
    email: string;
    id: string;
    imageUrl?: string | null;
    username?: string | null;
  } | null;
  authorUserId: string | null;
  body: string;
  conversationId: string;
  createdAt: string;
  id: string;
  kind: "message" | "system";
  metadata: Record<string, unknown> | null;
  sourceId: string;
  sourceType: string;
  ticketId: string;
  updatedAt: string;
};

export type User = {
  id: string;
  tenantId?: string | null;
  displayName: string;
  email: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  mobile: string | null;
  imageUrl: string | null;
  nickname?: string | null;
  avatarUrl?: string | null;
  preferredLanguage: string;
  emailVerified: boolean;
  timeZone: string | null;
  tenantRole?: Role | null;
  status: UserStatus;
  type: "service" | "user";
  createdAt: string;
  updatedAt: string;
};

export type Role = {
  color?: string | null;
  description?: string | null;
  displayName?: string | null;
  id: string;
  isSystem: boolean;
  label: string;
  name: string;
  organizationId?: string | null;
  permissions?: RolePermission[];
  scope?: "platform" | "tenant" | "organization";
};

export type RolePermission = {
  id: string;
  enabled: boolean;
  permission: string;
  roleId: string;
};

export type PermissionScope =
  | "platform"
  | "tenant"
  | "organization"
  | "own";

export type PermissionCatalogOperation = {
  description?: string | null;
  isDangerous?: boolean;
  label: string;
  operation: string;
  order?: number | null;
  permission: string;
};

export type PermissionCatalogPurpose = {
  label: string;
  operations: PermissionCatalogOperation[];
  order?: number | null;
  purpose: string;
};

export type PermissionCatalogEntity = {
  entity: string;
  label: string;
  order?: number | null;
  purposes: PermissionCatalogPurpose[];
};

export type PermissionCatalogScope = {
  entities: PermissionCatalogEntity[];
  label: string;
  scope: PermissionScope;
};

export type PermissionCatalog = {
  scopes: PermissionCatalogScope[];
};

export type MembershipStatus = "active" | "disabled" | "invited";

export type OrganizationMembership = {
  displayName: string | null;
  id: string;
  joinedAt: string | null;
  organization?: Organization;
  organizationId: string;
  role: Role | null;
  status: MembershipStatus;
  user: User;
  userId: string;
};

export type OrganizationMembershipPayload = {
  displayName?: string | null;
  email?: string;
  password?: string;
  roleId?: string;
  status?: MembershipStatus;
  userId?: string;
};

export type PlatformMember = {
  displayName: string | null;
  id: string;
  role: Role | null;
  roleId: string | null;
  status: "active" | "disabled";
  user: User;
  userId: string;
};

export type PlatformMemberPayload = {
  displayName?: string | null;
  roleId?: string | null;
  status?: "active" | "disabled";
  userId?: string;
};

export type PlatformUser = {
  displayName: string;
  email: string;
  id: string;
  preferredLanguage?: string;
  roles: Role[];
  status: "active" | "disabled";
};

export type RolePayload = {
  color?: string | null;
  description?: string | null;
  displayName?: string;
  name?: string;
};

export type InviteStatus =
  | "accepted"
  | "declined"
  | "expired"
  | "invited"
  | "revoked";

export type Invite = {
  acceptedCount: number;
  acceptedUserId: string | null;
  actionDate: string | null;
  closedAt: string | null;
  email: string | null;
  existingUser?: boolean;
  createdAt: string;
  expireDate: string | null;
  id: string;
  invitedById: string | null;
  invitedBy?: Pick<
    User,
    "avatarUrl" | "displayName" | "email" | "id" | "imageUrl" | "username"
  > | null;
  link?: string;
  organizationAssignments: Array<{
    isDefault?: boolean;
    organizationId: string;
    roleId: string;
  }>;
  status: InviteStatus;
  workspaceRoleId: string;
};

export type SystemSettingDto = {
  id: string;
  name: string;
  scope: string;
  value: string | null;
  valueOptions?: SettingValueOption[] | null;
  valueType: SettingValueType;
};

export type SettingPayloadValue =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | unknown[]
  | null;

export type SettingPayloadEntry = {
  name: string;
  value: SettingPayloadValue;
  valueOptions?: SettingValueOption[] | null;
  valueType?: SettingValueType;
};

export type SaveSettingsPayload =
  | Record<string, SettingPayloadValue>
  | { settings: SettingPayloadEntry[] };

export type CurrentUser = {
  isPlatformAdmin?: boolean;
  memberships?: OrganizationMembership[];
  organization: Organization | null;
  permissions: string[];
  platformUser?: PlatformUser | null;
  principalType: "platform" | "tenant";
  role: Role | null;
  user: User;
};

export type TenantPrincipalSession = {
  defaultOrganizationId: string | null;
  isPlatformAdmin?: boolean;
  memberships: OrganizationMembership[];
  onboarding: { rootOrganizationRequired: boolean };
  organization?: Organization | null;
  permissions: string[];
  role?: Role | null;
  principalType: "tenant";
  systemSettings?: SystemSettingDto[];
  tenant?: Tenant | null;
  tenantId: string;
  tenantRole: Role | null;
  user: User;
};

export type PlatformPrincipalSession = {
  platformUser: PlatformUser;
  principalType: "platform";
  systemSettings?: SystemSettingDto[];
};

export type PrincipalSession = TenantPrincipalSession | PlatformPrincipalSession;

export type Snapshot = {
  currentUser: CurrentUser;
  defaultOrganizationId?: string | null;
  isPlatformAdmin: boolean;
  memberships: OrganizationMembership[];
  organization: Organization | null;
  organizations: Organization[];
  permissions: string[];
  platformUser?: PlatformUser | null;
  principalType: "platform" | "tenant";
  role?: Role | null;
  rolePermissions: RolePermission[];
  roles: Role[];
  systemSettings: SystemSettingDto[];
  tenant?: Tenant | null;
  tenantId?: string | null;
  tenantRole?: Role | null;
  user: User;
  users: User[];
};

export type PublicBootstrap = {
  onboardingRequired: boolean;
  organizations: Organization[];
  systemSettings?: SystemSettingDto[];
};

export type AuthLoginResponse = {
  expiresAt: string;
  sessionId: string;
  snapshot: TenantPrincipalSession;
};

export type PlatformAuthLoginResponse = {
  expiresAt: string;
  sessionId: string;
  snapshot: PlatformPrincipalSession;
};

export type AuthRefreshResponse = {
  expiresAt: string;
  sessionId: string;
};

export type RealtimeTicketResponse = {
  expiresAt: string;
  ticket: string;
};

export type AuthSessionDevice = {
  browser: string;
  createdAt: string;
  deviceLabel: string;
  expiresAt: string;
  ipAddress: string | null;
  isCurrent: boolean;
  isExpired: boolean;
  lastSeenAt: string;
  os: string;
  revokedAt: string | null;
  sessionId: string;
};

export type IntegrationTokenScope = "tenant";

export type IntegrationTokenPermissionOption = {
  description: string | null;
  entity: string;
  entityLabel: string;
  entityOrder: number | null;
  isDangerous: boolean;
  label: string;
  operation: string;
  operationOrder: number | null;
  permission: string;
  purpose: string;
  purposeLabel: string;
  purposeOrder: number | null;
  scope: "tenant" | "organization" | "own";
};

export type IntegrationTokenScopeCapability = {
  permissions: IntegrationTokenPermissionOption[];
  scope: IntegrationTokenScope;
};

export type IntegrationTokenCapabilities = {
  scopes: IntegrationTokenScopeCapability[];
};

export type IntegrationToken = {
  createdAt: string;
  expiresAt: string;
  id: string;
  isExpired: boolean;
  lastUsedAt: string | null;
  note: string | null;
  owner?: Pick<
    User,
    "avatarUrl" | "displayName" | "email" | "id" | "imageUrl" | "username"
  > | null;
  ownerUserId?: string;
  permissions: string[];
  revokedAt: string | null;
  scope: IntegrationTokenScope;
  tenantId: string;
  tokenPrefix: string;
  updatedAt: string;
};

export type CreatedIntegrationToken = IntegrationToken & {
  token: string;
};

export type OnboardingPayload = {
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  organizationName: string;
  organizationSlug?: string;
};

export type LoginPayload = {
  email: string;
  password: string;
  tenantSlug?: string;
};

export type TenantLoginContext = {
  source: "host" | "workspace" | null;
  tenant: { name: string; slug: string } | null;
};

export type FileUploadResponse = {
  destinations: Array<{
    kind: string;
    status: "failed" | "success";
    url?: string;
  }>;
  mimeType?: string;
  name?: string;
  originalName?: string;
  size?: number;
  status: "failed" | "partial_success" | "success";
  url?: string;
};

const API_BASE_URL = "/api";
const ADMIN_API_BASE_URL = "/api/admin";
const REQUEST_TIMEOUT_MS = 12_000;

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

export async function fetchAdmin<T>(
  path: string,
  options?: {
    body?: unknown;
    method?: string;
  },
): Promise<T> {
  const response = await sendAdminRequest(path, options);
  return parseAdminResponse<T>(response);
}

async function sendAdminRequest(
  path: string,
  options?: {
    body?: unknown;
    method?: string;
  },
) {
  const headers = new Headers();
  const scopedRequest = shouldAttachRequestScope(path);
  if (options?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const scopeSignal = getOrganizationRequestSignal();
  const abortForScopeChange = () => controller.abort();
  if (scopedRequest) {
    if (scopeSignal.aborted) abortForScopeChange();
    else {
      scopeSignal.addEventListener("abort", abortForScopeChange, { once: true });
    }
  }
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
      method: options?.method ?? "GET",
      headers,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "include",
      signal: controller.signal,
    });
  } catch (error) {
    if (scopedRequest && scopeSignal.aborted) {
      throw new DOMException("Organization changed", "AbortError");
    }
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("请求超时，请确认 API 服务已启动");
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
    scopeSignal.removeEventListener("abort", abortForScopeChange);
  }

  return response;
}

function shouldAttachRequestScope(path: string) {
  // The principal snapshot establishes the initial request scope. Binding this
  // request to the previous scope lets the first successful hydration abort a
  // concurrent /auth/me call (for example React Strict Mode's second effect).
  if (path === "/auth/me") return false;
  if (path === "/platform" || path.startsWith("/platform/")) return false;
  const publicPath = [
    "/auth/login",
    "/auth/tenant-context",
    "/auth/refresh",
    "/auth/request-password",
    "/auth/reset-password",
    "/bootstrap",
    "/invites/accept",
    "/invites/validate",
    "/onboarding",
    "/platform/auth/login",
    "/tenant-applications",
  ].some((candidate) => path === candidate || path.startsWith(`${candidate}?`));
  if (publicPath) return false;
  return !/^\/tenant-applications\/[^/]+\/(?:verify|cancel)(?:\?|$)/.test(path);
}

async function parseAdminResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.json().catch(() => undefined);
    const message = Array.isArray(detail?.message)
      ? detail.message.join(", ")
      : detail?.message;
    throw new AdminApiError(
      message || `请求失败：${response.status}`,
      response.status,
      typeof detail?.code === "string" ? detail.code : undefined,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return null as T;
  }

  return maskSecretSettingPayload(JSON.parse(text)) as T;
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
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(`${ADMIN_API_BASE_URL}/files/upload`, {
    body,
    credentials: "include",
    method: "POST",
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => undefined);
    const message = Array.isArray(detail?.message)
      ? detail.message.join(", ")
      : detail?.message;
    throw new Error(message || `请求失败：${response.status}`);
  }

  return response.json() as Promise<FileUploadResponse>;
}

export function getPublicBootstrap() {
  return fetchAdmin<PublicBootstrap>("/bootstrap");
}

export function authLogin(payload: LoginPayload) {
  return fetchAdmin<AuthLoginResponse>("/auth/login", {
    body: payload,
    method: "POST",
  });
}

export function resolveTenantLoginContext(workspace?: string) {
  return fetchAdmin<TenantLoginContext>("/auth/tenant-context", {
    body: workspace ? { workspace } : {},
    method: "POST",
  });
}

export function platformAuthLogin(payload: LoginPayload) {
  return fetchAdmin<PlatformAuthLoginResponse>("/platform/auth/login", {
    body: payload,
    method: "POST",
  });
}

export function submitTenantApplication(payload: TenantApplicationPayload) {
  return fetchAdmin<TenantApplicationSubmission>("/tenant-applications", {
    body: payload,
    method: "POST",
  });
}

export function verifyTenantApplication(
  applicationId: string,
  token: string,
) {
  return fetchAdmin<TenantApplication>(
    `/tenant-applications/${applicationId}/verify`,
    { body: { token }, method: "POST" },
  );
}

export function cancelTenantApplication(applicationId: string, token: string) {
  return fetchAdmin<TenantApplication>(
    `/tenant-applications/${applicationId}/cancel`,
    { body: { token }, method: "POST" },
  );
}

export function listTenantApplications(
  session: AuthenticatedAdminSessionMarker,
) {
  return fetchAdmin<TenantApplication[]>("/platform/tenant-applications", {});
}

export function listPlatformTenants(
  session: AuthenticatedAdminSessionMarker,
) {
  return fetchAdmin<Tenant[]>("/platform/tenants", {});
}

export function updatePlatformTenantStatus(
  session: AuthenticatedAdminSessionMarker,
  tenantId: string,
  status: "active" | "archived" | "suspended",
) {
  return fetchAdmin<Tenant>(`/platform/tenants/${tenantId}/status`, {
    body: { status },
    method: "PATCH",
  });
}

export function approveTenantApplication(
  session: AuthenticatedAdminSessionMarker,
  applicationId: string,
  payload: { note?: string | null; organizationName?: string },
) {
  return fetchAdmin<TenantApplicationApproval>(
    `/platform/tenant-applications/${applicationId}/approve`,
    { body: payload, method: "POST" },
  );
}

export function rejectTenantApplication(
  session: AuthenticatedAdminSessionMarker,
  applicationId: string,
  payload: { note?: string | null },
) {
  return fetchAdmin<TenantApplication>(
    `/platform/tenant-applications/${applicationId}/reject`,
    { body: payload, method: "POST" },
  );
}

export function onboard(payload: OnboardingPayload) {
  return fetchAdmin<AuthLoginResponse>("/onboarding", {
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

export function requestPasswordReset(email: string, tenantSlug?: string) {
  return fetchAdmin<{ success: boolean }>("/auth/request-password", {
    body: { email, tenantSlug },
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
  return fetchAdmin<PrincipalSession>("/auth/me", {});
}

export function searchUsers(session: AuthenticatedAdminSessionMarker, search: string) {
  const suffix = search.trim()
    ? `?search=${encodeURIComponent(search.trim())}`
    : "";
  return fetchAdmin<User[]>(`/users/search${suffix}`, {});
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
  return fetchAdmin<User>("/users/me", { body: payload, method: "PATCH" });
}

export function updateUserPassword(session: AuthenticatedAdminSessionMarker, payload: {
  currentPassword: string;
  password: string;
}) {
  return fetchAdmin<void>("/users/me/password", { body: payload, method: "POST" });
}

export function updateUserPreferredLanguage(
  session: AuthenticatedAdminSessionMarker,
  preferredLanguage: string,
) {
  return fetchAdmin<User>("/users/me/preferred-language", {
    body: { preferredLanguage },
    method: "PATCH",
  });
}

export type SmtpConfig = {
  fromAddress: string | null;
  host: string;
  id: string;
  isValidated: boolean;
  port: number;
  secure: boolean;
  username: string | null;
};

export type EmailTemplateDto = {
  description: string | null;
  hbs: string;
  hasPlatformDefault: boolean;
  id: string;
  inherited: boolean;
  isSystem: boolean;
  languageCode: string;
  mjml: string | null;
  name: string;
  subject: string | null;
};

export function getSmtpConfig(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<SmtpConfig | null>("/tenant/mail/smtp", {});
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
  return fetchAdmin<SmtpConfig>("/tenant/mail/smtp", { body: payload, method: "PUT" });
}

export function validateSmtpConfig(session: AuthenticatedAdminSessionMarker, payload: {
  fromAddress?: string | null;
  host?: string;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}) {
  return fetchAdmin<{ ok: boolean }>("/tenant/mail/smtp/validate", { body: payload, method: "POST" });
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

export function createUser(session: AuthenticatedAdminSessionMarker, payload: {
  displayName?: string;
  email?: string;
  password?: string;
  roleId?: string | null;
  status?: UserStatus;
}) {
  return fetchAdmin<User>("/users", { body: payload, method: "POST" });
}

export function listUsers(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<User[]>("/users", {});
}

export function updateManagedUser(session: AuthenticatedAdminSessionMarker, userId: string, payload: {
  displayName?: string;
  email?: string;
  roleId?: string | null;
  status?: UserStatus;
}) {
  return fetchAdmin<User>(`/users/${userId}`, { body: payload, method: "PATCH" });
}

export function deleteManagedUser(session: AuthenticatedAdminSessionMarker, userId: string) {
  return fetchAdmin<void>(`/users/${userId}`, {
    method: "DELETE",
  });
}

export function replaceUserTenantRoles(
  session: AuthenticatedAdminSessionMarker,
  userId: string,
  roleId: string,
) {
  return fetchAdmin<User>(`/users/${userId}/role`, {
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
    organizations: Array<{
      isDefault?: boolean;
      organizationId: string;
      roleId: string;
    }>;
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
  return fetchAdmin<EmailTemplateDto[]>("/tenant/mail/templates", {});
}

export function createEmailTemplate(session: AuthenticatedAdminSessionMarker, payload: {
  description?: string | null;
  hbs: string;
  languageCode: string;
  mjml?: string | null;
  name: string;
  subject?: string | null;
}) {
  return fetchAdmin<EmailTemplateDto>("/tenant/mail/templates", { body: payload, method: "POST" });
}

export function updateEmailTemplate(session: AuthenticatedAdminSessionMarker, templateId: string, payload: Partial<{
  description: string | null;
  hbs: string;
  languageCode: string;
  mjml: string | null;
  name: string;
  subject: string | null;
}>) {
  return fetchAdmin<EmailTemplateDto>(`/tenant/mail/templates/${templateId}`, { body: payload, method: "PATCH" });
}

export function deleteEmailTemplate(session: AuthenticatedAdminSessionMarker, templateId: string) {
  return fetchAdmin<void>(`/tenant/mail/templates/${templateId}`, { method: "DELETE" });
}

export function previewEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  payload: { hbs: string; subject?: string | null },
  scope: "platform" | "tenant" = "tenant",
) {
  const path = scope === "platform"
    ? "/platform/mail/templates/preview"
    : "/tenant/mail/templates/preview";
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

export function listOrganizations(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Organization[]>("/organizations", {});
}

export function updateTenant(
  session: AuthenticatedAdminSessionMarker,
  payload: Partial<Pick<Tenant, "name">>,
) {
  return fetchAdmin<Tenant>("/tenant", {
    body: payload,
    method: "PATCH",
  });
}

export function listTenantRoles(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Role[]>("/roles", {});
}

export function createTenantRole(
  session: AuthenticatedAdminSessionMarker,
  payload: RolePayload,
) {
  return fetchAdmin<Role>("/roles", {
    body: payload,
    method: "POST",
  });
}

export function updateTenantRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/roles/${roleId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function replaceTenantRolePermissions(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  permissions: Array<{ enabled?: boolean; permission?: string }>,
) {
  return fetchAdmin<Role>(`/roles/${roleId}/permissions`, {
    body: { permissions },
    method: "PUT",
  });
}

export function deleteTenantRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
) {
  return fetchAdmin<{ success: boolean }>(`/roles/${roleId}`, {
    method: "DELETE",
  });
}

export function listOrganizationRoles(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
) {
  return fetchAdmin<Role[]>(`/organizations/${organizationId}/roles`, {});
}

export function createOrganizationRole(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/organizations/${organizationId}/roles`, {
    body: payload,
    method: "POST",
  });
}

export function updateOrganizationRole(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  roleId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/organizations/${organizationId}/roles/${roleId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function replaceOrganizationRolePermissions(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  roleId: string,
  permissions: Array<{ enabled?: boolean; permission?: string }>,
) {
  return fetchAdmin<Role>(
    `/organizations/${organizationId}/roles/${roleId}/permissions`,
    { body: { permissions }, method: "PUT" },
  );
}

export function deleteOrganizationRole(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  roleId: string,
) {
  return fetchAdmin<{ success: boolean }>(
    `/organizations/${organizationId}/roles/${roleId}`,
    { method: "DELETE" },
  );
}

export function getOrganization(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<Organization>(`/organizations/${organizationId}`, {});
}

export function updateOrganization(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: OrganizationPayload,
) {
  return fetchAdmin<Organization>(`/organizations/${organizationId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function deleteOrganization(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
) {
  return fetchAdmin<{ deleted: boolean; id: string }>(
    `/organizations/${organizationId}`,
    { method: "DELETE" },
  );
}

export function createOrganization(session: AuthenticatedAdminSessionMarker, payload: OrganizationPayload) {
  return fetchAdmin<Organization>("/organizations", {
    body: payload,
    method: "POST",
  });
}

export function listOrganizationMembers(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<OrganizationMembership[]>(
    `/organizations/${organizationId}/members`,
    {},
  );
}

export function createOrganizationMember(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: OrganizationMembershipPayload,
) {
  return fetchAdmin<OrganizationMembership>(
    `/organizations/${organizationId}/members`,
    { body: payload, method: "POST" },
  );
}

export function updateOrganizationMember(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  membershipId: string,
  payload: OrganizationMembershipPayload,
) {
  return fetchAdmin<OrganizationMembership>(
    `/organizations/${organizationId}/members/${membershipId}`,
    { body: payload, method: "PATCH" },
  );
}

export function replaceOrganizationMemberRole(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  membershipId: string,
  roleId: string,
) {
  return fetchAdmin<OrganizationMembership>(
    `/organizations/${organizationId}/members/${membershipId}/role`,
    { body: { roleId }, method: "PUT" },
  );
}

export function deleteOrganizationMember(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  membershipId: string,
) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/members/${membershipId}`,
    { method: "DELETE" },
  );
}

export function listPermissionCatalog(
  session: AuthenticatedAdminSessionMarker,
) {
  void session;
  return fetchAdmin<PermissionCatalog>("/permissions/catalog", {
  });
}

export function listPlatformPermissionCatalog(
  session: AuthenticatedAdminSessionMarker,
) {
  void session;
  return fetchAdmin<PermissionCatalog>("/platform/permissions/catalog", {});
}

export function listOrganizationPermissionCatalog(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
) {
  return fetchAdmin<PermissionCatalog>(
    `/organizations/${organizationId}/permissions/catalog`,
    {},
  );
}

export function listPlatformMembers(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<PlatformMember[]>("/platform/members", {});
}

export function createPlatformMember(session: AuthenticatedAdminSessionMarker, payload: PlatformMemberPayload) {
  return fetchAdmin<PlatformMember>("/platform/members", {
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
    organizationId?: string | null;
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
  options: { sourceOrganizationId?: string | null; status?: TicketStatus } = {},
) {
  const params = new URLSearchParams();
  if (options.sourceOrganizationId) {
    params.set("sourceOrganizationId", options.sourceOrganizationId);
  }
  if (options.status) params.set("status", options.status);
  const query = params.toString();
  return fetchAdmin<Ticket[]>(`/tickets${query ? `?${query}` : ""}`, {});
}

export function createTicket(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    attachments?: TicketMessageAttachment[] | null;
    body: string;
    sourceOrganizationId: string;
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
