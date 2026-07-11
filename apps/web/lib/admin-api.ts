import {
  SECRET_SETTING_MASK,
  type SettingValueOption,
  type SettingValueType,
} from "@hermes-swarm/core/settings/definitions";
import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import {
  buildRequestScopeHeaders,
  getActiveRequestScope,
  getRequestScopeSignal,
  type RequestScopeLevel,
} from "@/lib/request-scope";

export type { RequestScopeLevel } from "@/lib/request-scope";

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
  organization: Organization;
  ownerActivationToken?: string;
  ownerUser: User;
  tenant: Tenant;
};

export type Department = {
  code: string | null;
  description: string | null;
  id: string;
  name: string;
  organizationId: string;
  parentDepartmentId: string | null;
  slug: string;
  status: "active" | "disabled";
  tenantId: string;
};

export type DepartmentMembership = {
  department: Department;
  departmentId: string;
  id: string;
  isDefault?: boolean;
  joinedAt?: string | null;
  membership?: OrganizationMembership;
  membershipId?: string;
  organizationId: string;
  status: MembershipStatus;
  tenantId: string;
};

export type DepartmentPayload = {
  code?: string | null;
  description?: string | null;
  name: string;
  parentDepartmentId?: string | null;
  slug?: string;
  status?: "active" | "disabled";
};

export type DepartmentDispatchType =
  | "handoff"
  | "escalation"
  | "collaboration"
  | "fallback";

export type DepartmentDispatchRelation = {
  id: string;
  isEnabled: boolean;
  policy: Record<string, unknown>;
  priority: number;
  sourceDepartment?: Department;
  sourceDepartmentId: string;
  targetDepartment?: Department;
  targetDepartmentId: string;
  tenantId: string;
  type: DepartmentDispatchType;
};

export type Organization = {
  banner: string | null;
  brandColor: string | null;
  clientFocus: string | null;
  createdByUserId?: string | null;
  currency: string | null;
  dateFormat: string | null;
  id: string;
  imageUrl: string | null;
  isDefault: boolean;
  logoUrl?: string | null;
  name: string;
  officialName: string | null;
  overview: string | null;
  preferredLanguage: string | null;
  profileLink: string | null;
  regionCode: string | null;
  shortDescription: string | null;
  slug: string;
  status: OrganizationStatus;
  subdomain: string | null;
  timeZone: string | null;
  totalEmployees: number | null;
  website: string | null;
};

export type OrganizationPayload = Partial<{
  banner: string | null;
  brandColor: string | null;
  clientFocus: string | null;
  currency: string | null;
  dateFormat: string | null;
  imageUrl: string | null;
  isDefault: boolean;
  name: string;
  officialName: string | null;
  overview: string | null;
  preferredLanguage: string | null;
  profileLink: string | null;
  regionCode: string | null;
  shortDescription: string | null;
  slug: string;
  status: OrganizationStatus;
  subdomain: string | null;
  timeZone: string | null;
  totalEmployees: number | null;
  website: string | null;
}>;

export type NotificationDestinationType = {
  icon?: string;
  name: string;
  schema?: {
    properties?: Record<string, { title?: string; type?: string }>;
    required?: string[];
    secret?: string[];
    type?: string;
  };
  type: string;
};

export type NotificationDestination = {
  id: string;
  name: string;
  options: Record<string, unknown> | null;
  organizationId: string | null;
  type: string;
};

export type NotificationDestinationGroup = Record<string, unknown>;

export type UserNotificationStatus = "read" | "unread";
export type UserNotificationKind = "error" | "info" | "success" | "warning";

export type UserNotification = {
  actorUserId: string | null;
  body: string | null;
  createdAt: string;
  dismissedAt: string | null;
  id: string;
  kind: UserNotificationKind;
  organizationId: string | null;
  payload: Record<string, unknown> | null;
  readAt: string | null;
  sourceId: string | null;
  sourceType: string | null;
  status: UserNotificationStatus;
  title: string;
  updatedAt: string;
};

export type TicketStatus = "archived" | "closed" | "open";
export type TicketScope = "tenant" | "organization" | "department";

export type Ticket = {
  archivedAt: string | null;
  assigneeUserId: string | null;
  conversationId: string | null;
  createdAt: string;
  handlerClosedAt: string | null;
  id: string;
  lastMessageAt: string | null;
  organizationId: string | null;
  participantUserIds: string[];
  requesterClosedAt: string | null;
  requesterUserId: string;
  scope: TicketScope;
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
  organizationId: string | null;
  permissions?: RolePermission[];
  scope?: "platform" | "tenant" | "organization" | "department";
};

export type RolePermission = {
  id: string;
  enabled: boolean;
  permission: string;
  roleId: string;
  organizationId: string | null;
};

export type PermissionScope =
  | "platform"
  | "tenant"
  | "organization"
  | "department"
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

export type OrganizationGroupBrief = {
  color: string | null;
  displayName: string;
  id: string;
  name: string;
  organizationId: string;
};

export type OrganizationMembership = {
  displayName: string | null;
  groupIds?: string[];
  groups?: OrganizationGroupBrief[];
  id: string;
  joinedAt: string | null;
  organization?: Organization;
  organizationId: string;
  role: Role | null;
  roleId: string | null;
  status: MembershipStatus;
  user: User;
  userId: string;
};

export type OrganizationMembershipPayload = {
  displayName?: string | null;
  email?: string;
  password?: string;
  roleId?: string | null;
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

export type OrganizationGroup = OrganizationGroupBrief & {
  createdAt: string;
  createdByUserId: string | null;
  description: string | null;
  memberCount: number;
  updatedAt: string;
};

export type OrganizationGroupPayload = {
  color?: string | null;
  description?: string | null;
  displayName?: string;
  name?: string;
};

export type OrganizationGroupMember = {
  group: OrganizationGroupBrief | null;
  groupId: string;
  id: string;
  membership: OrganizationMembership | null;
  membershipId: string;
  organizationId: string;
  user: User;
  userId: string;
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
  organization?: {
    id: string;
    imageUrl: string | null;
    logoUrl: string | null;
    name: string;
    shortDescription: string | null;
    slug: string;
  };
  role?: Pick<
    Role,
    "color" | "displayName" | "id" | "isSystem" | "label" | "name"
  > | null;
  roleId: string | null;
  status: InviteStatus;
};

export type OrganizationSetting = {
  id: string;
  defaultValue?: string | null;
  isOverridden?: boolean;
  name: string;
  organizationId: string;
  overrideValue?: string | null;
  scope?: "organization" | "platform" | string;
  value: string | null;
  valueOptions?: SettingValueOption[] | null;
  valueType: SettingValueType;
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

export type PrincipalDefaultScope = {
  departmentId?: string | null;
  level: RequestScopeLevel;
  organizationId?: string | null;
};

export type TenantPrincipalSession = {
  allowedScopes?: RequestScopeLevel[];
  defaultScope?: PrincipalDefaultScope | null;
  departmentMemberships?: DepartmentMembership[];
  isPlatformAdmin?: boolean;
  memberships: OrganizationMembership[];
  organization?: Organization | null;
  permissions: string[];
  role?: Role | null;
  principalType: "tenant";
  systemSettings?: SystemSettingDto[];
  tenant?: Tenant | null;
  tenantId: string;
  tenantRoles?: Role[];
  user: User;
};

export type PlatformPrincipalSession = {
  platformUser: PlatformUser;
  principalType: "platform";
  systemSettings?: SystemSettingDto[];
};

export type PrincipalSession = TenantPrincipalSession | PlatformPrincipalSession;

export type Snapshot = {
  allowedScopes?: RequestScopeLevel[];
  currentUser: CurrentUser;
  defaultScope?: PrincipalDefaultScope | null;
  departmentMemberships?: DepartmentMembership[];
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
  scope: {
    level: RequestScopeLevel | "platform";
    departmentId?: string | null;
    organizationId: string | null;
  };
  settings: OrganizationSetting[];
  systemSettings: SystemSettingDto[];
  tenant?: Tenant | null;
  tenantId?: string | null;
  tenantRoles?: Role[];
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

export type IntegrationTokenScope = "tenant" | "organization" | "department";

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
};

export type IntegrationTokenScopeCapability = {
  departmentId: string | null;
  departmentName: string | null;
  organizationId: string | null;
  organizationName: string | null;
  permissions: IntegrationTokenPermissionOption[];
  scope: IntegrationTokenScope;
};

export type IntegrationTokenCapabilities = {
  scopes: IntegrationTokenScopeCapability[];
};

export type IntegrationToken = {
  createdAt: string;
  departmentId: string | null;
  departmentName?: string | null;
  expiresAt: string;
  id: string;
  isExpired: boolean;
  lastUsedAt: string | null;
  note: string | null;
  organizationId: string | null;
  organizationName?: string | null;
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
    scope?: {
      departmentId?: string | null;
      level: RequestScopeLevel;
      organizationId?: string | null;
    };
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
    scope?: {
      departmentId?: string | null;
      level: RequestScopeLevel;
      organizationId?: string | null;
    };
  },
) {
  const headers = new Headers();
  const scopedRequest = shouldAttachRequestScope(path);
  if (scopedRequest) {
    const activeScope = getActiveRequestScope();
    const requestScope = options?.scope
      ? {
          departmentId: options.scope.departmentId ?? null,
          level: options.scope.level,
          organizationId: options.scope.organizationId ?? null,
          tenantId: activeScope?.tenantId ?? null,
        }
      : activeScope;
    for (const [name, value] of Object.entries(
      buildRequestScopeHeaders(requestScope),
    )) {
      headers.set(name, value);
    }
  }
  if (options?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const controller = new AbortController();
  const scopeSignal = getRequestScopeSignal();
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
      throw new DOMException("Request scope changed", "AbortError");
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
  if (path === "/platform" || path.startsWith("/platform/")) return false;
  const publicPath = [
    "/auth/login",
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

export function requestPasswordReset(email: string) {
  return fetchAdmin<{ success: boolean }>("/auth/request-password", {
    body: { email },
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

export function getIntegrationTokenCapabilities(session: AuthenticatedAdminSessionMarker, userId: string) {
  return fetchAdmin<IntegrationTokenCapabilities>(
    `/users/${userId}/integration-tokens/capabilities`,
    {},
  );
}

export function listIntegrationTokens(session: AuthenticatedAdminSessionMarker, userId: string) {
  return fetchAdmin<IntegrationToken[]>(
    `/users/${userId}/integration-tokens`,
    {},
  );
}

export function createIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  userId: string,
  payload: {
    departmentId?: string | null;
    expiresAt?: string;
    note?: string | null;
    organizationId?: string | null;
    permissions: string[];
    scope: IntegrationTokenScope;
  },
) {
  return fetchAdmin<CreatedIntegrationToken>(
    `/users/${userId}/integration-tokens`,
    { body: payload, method: "POST" },
  );
}

export function revokeIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  userId: string,
  integrationTokenId: string,
) {
  return fetchAdmin<void>(
    `/users/${userId}/integration-tokens/${integrationTokenId}`,
    { method: "DELETE" },
  );
}

export function listOrganizationIntegrationTokens(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
) {
  return fetchAdmin<IntegrationToken[]>(
    `/organizations/${organizationId}/integration-tokens`,
    {},
  );
}

export function revokeOrganizationIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  integrationTokenId: string,
) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/integration-tokens/${integrationTokenId}`,
    { method: "DELETE" },
  );
}

export function createOrganizationIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: {
    expiresAt?: string;
    note?: string | null;
    permissions: string[];
  },
) {
  return fetchAdmin<CreatedIntegrationToken>(
    `/organizations/${organizationId}/integration-tokens`,
    { body: payload, method: "POST" },
  );
}

export function listDepartmentIntegrationTokens(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  departmentId: string,
) {
  return fetchAdmin<IntegrationToken[]>(
    `/organizations/${organizationId}/departments/${departmentId}/integration-tokens`,
    {},
  );
}

export function createDepartmentIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  departmentId: string,
  payload: {
    expiresAt?: string;
    note?: string | null;
    permissions: string[];
  },
) {
  return fetchAdmin<CreatedIntegrationToken>(
    `/organizations/${organizationId}/departments/${departmentId}/integration-tokens`,
    { body: payload, method: "POST" },
  );
}

export function revokeDepartmentIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  departmentId: string,
  integrationTokenId: string,
) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/departments/${departmentId}/integration-tokens/${integrationTokenId}`,
    { method: "DELETE" },
  );
}

export function getOrganizationInvites(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<Invite[]>(`/organizations/${organizationId}/invites`, {
  });
}

export function createOrganizationInvites(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: { emailIds?: string[]; expiresIn?: "3d" | "7d" | "never"; roleId?: string },
) {
  return fetchAdmin<{ ignored: number; items: Invite[]; total: number }>(
    `/organizations/${organizationId}/invites`,
    { body: payload, method: "POST" },
  );
}

export function resendOrganizationInvite(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  inviteId: string,
) {
  return fetchAdmin<Invite>(
    `/organizations/${organizationId}/invites/${inviteId}/resend`,
    { method: "POST" },
  );
}

export function deleteOrganizationInvite(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  inviteId: string,
) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/invites/${inviteId}`,
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

export function updateUser(session: AuthenticatedAdminSessionMarker, userId: string, payload: {
  displayName?: string;
  email?: string;
  firstName?: string | null;
  imageUrl?: string | null;
  lastName?: string | null;
  mobile?: string | null;
  username?: string | null;
}) {
  return fetchAdmin<User>(`/users/${userId}`, { body: payload, method: "PATCH" });
}

export function updateUserPassword(session: AuthenticatedAdminSessionMarker, userId: string, payload: {
  currentPassword: string;
  password: string;
}) {
  return fetchAdmin<void>(`/users/${userId}/password`, { body: payload, method: "POST" });
}

export function updateUserPreferredLanguage(
  session: AuthenticatedAdminSessionMarker,
  userId: string,
  preferredLanguage: string,
) {
  return fetchAdmin<User>(`/users/${userId}/preferred-language`, {
    body: { preferredLanguage },
    method: "PATCH",
  });
}

export type SmtpConfig = {
  fromAddress: string | null;
  host: string;
  id: string;
  isValidated: boolean;
  organizationId: string | null;
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
  organizationId: string | null;
  subject: string | null;
};

type SmtpScopeOptions = {
  organizationId?: string;
};

export function getSmtpConfig(session: AuthenticatedAdminSessionMarker, options?: SmtpScopeOptions) {
  if (!options?.organizationId) {
    throw new Error("缺少组织 ID");
  }
  return fetchAdmin<SmtpConfig | null>(
    `/organizations/${options.organizationId}/mail/smtp`,
    {},
  );
}

export function saveSmtpConfig(session: AuthenticatedAdminSessionMarker, payload: {
  fromAddress?: string | null;
  host?: string;
  isValidated?: boolean;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}, options?: SmtpScopeOptions) {
  if (!options?.organizationId) {
    throw new Error("缺少组织 ID");
  }
  return fetchAdmin<SmtpConfig>(
    `/organizations/${options.organizationId}/mail/smtp`,
    { body: payload, method: "PUT" },
  );
}

export function validateSmtpConfig(session: AuthenticatedAdminSessionMarker, payload: {
  fromAddress?: string | null;
  host?: string;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}, options?: SmtpScopeOptions) {
  if (!options?.organizationId) {
    throw new Error("缺少组织 ID");
  }
  return fetchAdmin<{ ok: boolean }>(
    `/organizations/${options.organizationId}/mail/smtp/validate`,
    { body: payload, method: "POST" },
  );
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

export function updateManagedUser(session: AuthenticatedAdminSessionMarker, userId: string, payload: {
  displayName?: string;
  email?: string;
  roleId?: string | null;
  status?: UserStatus;
}) {
  return fetchAdmin<User>(`/users/tenant/${userId}`, { body: payload, method: "PATCH" });
}

export function deleteManagedUser(session: AuthenticatedAdminSessionMarker, userId: string) {
  return fetchAdmin<void>(`/users/tenant/${userId}`, {
    method: "DELETE",
  });
}

export function listEmailTemplates(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<EmailTemplateDto[]>(
    `/organizations/${organizationId}/mail/templates`,
    {},
  );
}

export function createEmailTemplate(session: AuthenticatedAdminSessionMarker, organizationId: string, payload: {
  description?: string | null;
  hbs: string;
  languageCode: string;
  mjml?: string | null;
  name: string;
  subject?: string | null;
}) {
  return fetchAdmin<EmailTemplateDto>(
    `/organizations/${organizationId}/mail/templates`,
    { body: payload, method: "POST" },
  );
}

export function updateEmailTemplate(session: AuthenticatedAdminSessionMarker, organizationId: string, templateId: string, payload: Partial<{
  description: string | null;
  hbs: string;
  languageCode: string;
  mjml: string | null;
  name: string;
  subject: string | null;
}>) {
  return fetchAdmin<EmailTemplateDto>(
    `/organizations/${organizationId}/mail/templates/${templateId}`,
    { body: payload, method: "PATCH" },
  );
}

export function deleteEmailTemplate(session: AuthenticatedAdminSessionMarker, organizationId: string, templateId: string) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/mail/templates/${templateId}`,
    { method: "DELETE" },
  );
}

export function previewEmailTemplate(
  session: AuthenticatedAdminSessionMarker,
  payload: { hbs: string; subject?: string | null },
  organizationId?: string,
) {
  const path = organizationId
    ? `/organizations/${organizationId}/mail/templates/preview`
    : "/platform/mail/templates/preview";
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

export function listOrganizationSettings(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<OrganizationSetting[]>(
    `/organizations/${organizationId}/settings`,
    {},
  );
}

export function saveOrganizationSettings(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<OrganizationSetting[]>(
    `/organizations/${organizationId}/settings`,
    { body: settings, method: "PUT" },
  );
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
  return fetchAdmin<Tenant>("/tenant", { body: payload, method: "PATCH" });
}

export function listDepartments(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
) {
  return fetchAdmin<Department[]>(
    `/organizations/${organizationId}/departments`,
    { scope: { level: "organization", organizationId } },
  );
}

export function createDepartment(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: DepartmentPayload,
) {
  return fetchAdmin<Department>(
    `/organizations/${organizationId}/departments`,
    {
      body: payload,
      method: "POST",
      scope: { level: "organization", organizationId },
    },
  );
}

export function updateDepartment(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  departmentId: string,
  payload: Partial<DepartmentPayload>,
) {
  return fetchAdmin<Department>(
    `/organizations/${organizationId}/departments/${departmentId}`,
    {
      body: payload,
      method: "PATCH",
      scope: { level: "organization", organizationId },
    },
  );
}

export function listDepartmentMembers(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  departmentId: string,
) {
  return fetchAdmin<DepartmentMembership[]>(
    `/organizations/${organizationId}/departments/${departmentId}/members`,
    {
      scope: { level: "organization", organizationId },
    },
  );
}

export function createDepartmentMember(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  departmentId: string,
  payload: { isDefault?: boolean; membershipId: string },
) {
  return fetchAdmin<DepartmentMembership>(
    `/organizations/${organizationId}/departments/${departmentId}/members`,
    {
      body: payload,
      method: "POST",
      scope: { level: "organization", organizationId },
    },
  );
}

export function removeDepartmentMember(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  departmentId: string,
  departmentMembershipId: string,
) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/departments/${departmentId}/members/${departmentMembershipId}`,
    {
      method: "DELETE",
      scope: { level: "organization", organizationId },
    },
  );
}

export function listDepartmentDispatchRelations(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  departmentId: string,
) {
  return fetchAdmin<DepartmentDispatchRelation[]>(
    `/organizations/${organizationId}/departments/${departmentId}/dispatch-relations`,
    {
      scope: { level: "organization", organizationId },
    },
  );
}

export function createDepartmentDispatchRelation(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: {
    isEnabled?: boolean;
    policy?: Record<string, unknown>;
    priority?: number;
    sourceDepartmentId: string;
    targetDepartmentId: string;
    type: DepartmentDispatchType;
  },
) {
  const { sourceDepartmentId, ...body } = payload;
  return fetchAdmin<DepartmentDispatchRelation>(
    `/organizations/${organizationId}/departments/${sourceDepartmentId}/dispatch-relations`,
    {
      body,
      method: "POST",
      scope: { level: "organization", organizationId },
    },
  );
}

export function deleteDepartmentDispatchRelation(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  sourceDepartmentId: string,
  relationId: string,
) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/departments/${sourceDepartmentId}/dispatch-relations/${relationId}`,
    {
      method: "DELETE",
      scope: { level: "organization", organizationId },
    },
  );
}

export function getOrganization(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<Organization>(`/organizations/${organizationId}`, {});
}

export function listOrganizationSettingsForOrganization(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
) {
  return fetchAdmin<OrganizationSetting[]>(
    `/organizations/${organizationId}/settings`,
    {},
  );
}

export function saveOrganizationSettingsForOrganization(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<OrganizationSetting[]>(
    `/organizations/${organizationId}/settings`,
    { body: settings, method: "PUT" },
  );
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

export function listOrganizationGroups(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<OrganizationGroup[]>(
    `/organizations/${organizationId}/groups`,
    {},
  );
}

export function createOrganizationGroup(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: OrganizationGroupPayload,
) {
  return fetchAdmin<OrganizationGroup>(
    `/organizations/${organizationId}/groups`,
    { body: payload, method: "POST" },
  );
}

export function getOrganizationGroup(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  groupId: string,
) {
  return fetchAdmin<OrganizationGroup>(
    `/organizations/${organizationId}/groups/${groupId}`,
    {},
  );
}

export function updateOrganizationGroup(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  groupId: string,
  payload: OrganizationGroupPayload,
) {
  return fetchAdmin<OrganizationGroup>(
    `/organizations/${organizationId}/groups/${groupId}`,
    { body: payload, method: "PATCH" },
  );
}

export function deleteOrganizationGroup(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  groupId: string,
) {
  return fetchAdmin<void>(`/organizations/${organizationId}/groups/${groupId}`, {
    method: "DELETE",
  });
}

export function listOrganizationGroupMembers(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  groupId: string,
) {
  return fetchAdmin<OrganizationGroupMember[]>(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    {},
  );
}

export function replaceOrganizationGroupMembers(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  groupId: string,
  membershipIds: string[],
) {
  return fetchAdmin<OrganizationGroupMember[]>(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    { body: { membershipIds }, method: "PUT" },
  );
}

export function listOrganizationRoles(session: AuthenticatedAdminSessionMarker, organizationId: string) {
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
  return fetchAdmin<RolePermission[]>(
    `/organizations/${organizationId}/roles/${roleId}/permissions`,
    { body: { permissions }, method: "PUT" },
  );
}

export function deleteOrganizationRole(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  roleId: string,
) {
  return fetchAdmin<void>(`/organizations/${organizationId}/roles/${roleId}`, {
    method: "DELETE",
  });
}

export function listPermissionCatalog(
  session: AuthenticatedAdminSessionMarker,
  scope?: PermissionScope,
) {
  const suffix = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  return fetchAdmin<PermissionCatalog>(`/permissions/catalog${suffix}`, {
  });
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

export function listNotificationDestinationTypes(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<NotificationDestinationType[]>(
    `/organizations/${organizationId}/notification-destinations/types`,
    {},
  );
}

export function listNotificationDestinations(session: AuthenticatedAdminSessionMarker, organizationId: string) {
  return fetchAdmin<NotificationDestination[]>(
    `/organizations/${organizationId}/notification-destinations`,
    {},
  );
}

export function createNotificationDestination(session: AuthenticatedAdminSessionMarker, organizationId: string, payload: {
  name: string;
  options?: Record<string, unknown> | null;
  type: string;
}) {
  return fetchAdmin<NotificationDestination>(
    `/organizations/${organizationId}/notification-destinations`,
    {
      body: payload,
      method: "POST",
    },
  );
}

export function updateNotificationDestination(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  destinationId: string,
  payload: Partial<{
    name: string;
    options: Record<string, unknown> | null;
    type: string;
  }>,
) {
  return fetchAdmin<NotificationDestination>(
    `/organizations/${organizationId}/notification-destinations/${destinationId}`,
    {
      body: payload,
      method: "PATCH",
    },
  );
}

export function deleteNotificationDestination(session: AuthenticatedAdminSessionMarker, organizationId: string, destinationId: string) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/notification-destinations/${destinationId}`,
    {
      method: "DELETE",
    },
  );
}

export function listNotificationDestinationGroups(session: AuthenticatedAdminSessionMarker, organizationId: string, destinationId: string) {
  return fetchAdmin<NotificationDestinationGroup[]>(
    `/organizations/${organizationId}/notification-destinations/${destinationId}/groups`,
    {},
  );
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

export function listOrganizationTickets(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  status?: TicketStatus,
) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return fetchAdmin<Ticket[]>(
    `/organizations/${organizationId}/tickets${suffix}`,
    {},
  );
}

export function createOrganizationTicket(
  session: AuthenticatedAdminSessionMarker,
  organizationId: string,
  payload: {
    attachments?: TicketMessageAttachment[] | null;
    body: string;
    subject: string;
  },
) {
  return fetchAdmin<Ticket & { firstMessage: TicketMessage }>(
    `/organizations/${organizationId}/tickets`,
    { body: payload, method: "POST" },
  );
}

export function listTenantTickets(session: AuthenticatedAdminSessionMarker, status?: TicketStatus) {
  const suffix = status ? `?status=${encodeURIComponent(status)}` : "";
  return fetchAdmin<Ticket[]>(`/tickets/tenant${suffix}`, {});
}

export function createTenantTicket(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    attachments?: TicketMessageAttachment[] | null;
    body: string;
    subject: string;
  },
) {
  return fetchAdmin<Ticket & { firstMessage: TicketMessage }>(
    "/tickets/tenant",
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
