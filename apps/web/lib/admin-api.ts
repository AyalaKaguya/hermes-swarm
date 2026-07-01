import {
  SECRET_SETTING_MASK,
  type SettingValueOption,
  type SettingValueType,
} from "@hermes-swarm/core/settings/definitions";

export type OrganizationStatus = "active" | "suspended";
export type RequestScopeLevel = "organization" | "platform";
export type UserStatus = "active" | "disabled";

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

export type User = {
  id: string;
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
  scope?: "organization" | "platform";
};

export type RolePermission = {
  id: string;
  enabled: boolean;
  permission: string;
  roleId: string;
  organizationId: string | null;
};

export type PermissionScope = "organization" | "own" | "platform";

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

export type InviteStatus = "invited" | "accepted" | "expired" | "revoked";

export type Invite = {
  id: string;
  email: string;
  status: InviteStatus;
  createdAt: string;
  actionDate: string | null;
  expireDate: string | null;
  roleId: string | null;
  invitedById: string | null;
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
  platformMembership?: PlatformMember | null;
  role: Role | null;
  user: User;
};

export type PrincipalSession = {
  isPlatformAdmin?: boolean;
  memberships: OrganizationMembership[];
  organization?: Organization | null;
  permissions: string[];
  platformMembership: PlatformMember | null;
  role?: Role | null;
  user: User;
};

export type Snapshot = {
  currentUser: CurrentUser;
  isPlatformAdmin: boolean;
  memberships: OrganizationMembership[];
  organization: Organization | null;
  organizations: Organization[];
  permissions: string[];
  platformMembership: PlatformMember | null;
  role?: Role | null;
  rolePermissions: RolePermission[];
  roles: Role[];
  scope: {
    level: RequestScopeLevel;
    organizationId: string | null;
  };
  settings: OrganizationSetting[];
  systemSettings: SystemSettingDto[];
  user: User;
  users: User[];
};

export type PublicBootstrap = {
  onboardingRequired: boolean;
  organizations: Organization[];
};

export type AuthLoginResponse = {
  snapshot: PrincipalSession;
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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3200/api";
const ADMIN_API_BASE_URL = `${API_BASE_URL.replace(/\/$/, "")}/admin`;
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

export async function fetchAdmin<T>(
  path: string,
  options?: {
    body?: unknown;
    method?: string;
    token?: string | null;
  },
): Promise<T> {
  const headers = new Headers();
  if (options?.body !== undefined) {
    headers.set("Content-Type", "application/json");
  }
  if (options?.token) {
    headers.set("Authorization", `Bearer ${options.token}`);
  }

  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response: Response;

  try {
    response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
      method: options?.method ?? "GET",
      headers,
      body: options?.body === undefined ? undefined : JSON.stringify(options.body),
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

export async function uploadAdminFile(token: string, file: File) {
  const body = new FormData();
  body.append("file", file);

  const response = await fetch(`${ADMIN_API_BASE_URL}/files/upload`, {
    body,
    headers: {
      Authorization: `Bearer ${token}`,
    },
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

export function onboard(payload: OnboardingPayload) {
  return fetchAdmin<AuthLoginResponse>("/onboarding", {
    body: payload,
    method: "POST",
  });
}

export function getOrganizationInvites(token: string, organizationId: string) {
  return fetchAdmin<Invite[]>(`/organizations/${organizationId}/invites`, {
    token,
  });
}

export function createOrganizationInvites(
  token: string,
  organizationId: string,
  payload: { emailIds?: string[]; roleId?: string },
) {
  return fetchAdmin<{ ignored: number; items: Invite[]; total: number }>(
    `/organizations/${organizationId}/invites`,
    { body: payload, method: "POST", token },
  );
}

export function resendOrganizationInvite(
  token: string,
  organizationId: string,
  inviteId: string,
) {
  return fetchAdmin<Invite>(
    `/organizations/${organizationId}/invites/${inviteId}/resend`,
    { method: "POST", token },
  );
}

export function deleteOrganizationInvite(
  token: string,
  organizationId: string,
  inviteId: string,
) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/invites/${inviteId}`,
    { method: "DELETE", token },
  );
}

export function fetchMe(token: string) {
  return fetchAdmin<PrincipalSession>("/auth/me", { token });
}

export function updateUser(token: string, userId: string, payload: {
  displayName?: string;
  email?: string;
  firstName?: string | null;
  imageUrl?: string | null;
  lastName?: string | null;
  mobile?: string | null;
  username?: string | null;
}) {
  return fetchAdmin<User>(`/users/${userId}`, { body: payload, method: "PATCH", token });
}

export function updateUserPassword(token: string, userId: string, payload: {
  currentPassword: string;
  password: string;
}) {
  return fetchAdmin<void>(`/users/${userId}/password`, { body: payload, method: "POST", token });
}

export function updateUserPreferredLanguage(
  token: string,
  userId: string,
  preferredLanguage: string,
) {
  return fetchAdmin<User>(`/users/${userId}/preferred-language`, {
    body: { preferredLanguage },
    method: "PATCH",
    token,
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
  hbs: string;
  id: string;
  languageCode: string;
  mjml: string | null;
  name: string;
  organizationId: string | null;
  subject: string | null;
};

type SmtpScopeOptions = {
  organizationId?: string;
};

export function getSmtpConfig(token: string, options?: SmtpScopeOptions) {
  if (!options?.organizationId) {
    throw new Error("缺少组织 ID");
  }
  return fetchAdmin<SmtpConfig | null>(
    `/organizations/${options.organizationId}/mail/smtp`,
    { token },
  );
}

export function saveSmtpConfig(token: string, payload: {
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
    { body: payload, method: "PUT", token },
  );
}

export function validateSmtpConfig(token: string, payload: {
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
    { body: payload, method: "POST", token },
  );
}

export function createUser(token: string, payload: {
  displayName?: string;
  email?: string;
  password?: string;
  roleId?: string | null;
  status?: UserStatus;
}) {
  return fetchAdmin<User>("/users", { body: payload, method: "POST", token });
}

export function updateManagedUser(token: string, userId: string, payload: {
  displayName?: string;
  email?: string;
  roleId?: string | null;
  status?: UserStatus;
}) {
  return fetchAdmin<User>(`/users/platform/${userId}`, { body: payload, method: "PATCH", token });
}

export function deleteManagedUser(token: string, userId: string) {
  return fetchAdmin<void>(`/users/platform/${userId}`, {
    method: "DELETE",
    token,
  });
}

export function listEmailTemplates(token: string, organizationId: string) {
  return fetchAdmin<EmailTemplateDto[]>(
    `/organizations/${organizationId}/mail/templates`,
    { token },
  );
}

export function createEmailTemplate(token: string, organizationId: string, payload: {
  hbs: string;
  languageCode: string;
  mjml?: string | null;
  name: string;
  subject?: string | null;
}) {
  return fetchAdmin<EmailTemplateDto>(
    `/organizations/${organizationId}/mail/templates`,
    { body: payload, method: "POST", token },
  );
}

export function updateEmailTemplate(token: string, organizationId: string, templateId: string, payload: Partial<{
  hbs: string;
  languageCode: string;
  mjml: string | null;
  name: string;
  subject: string | null;
}>) {
  return fetchAdmin<EmailTemplateDto>(
    `/organizations/${organizationId}/mail/templates/${templateId}`,
    { body: payload, method: "PATCH", token },
  );
}

export function deleteEmailTemplate(token: string, organizationId: string, templateId: string) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/mail/templates/${templateId}`,
    { method: "DELETE", token },
  );
}

export function listSystemSettings(token: string) {
  return fetchAdmin<SystemSettingDto[]>("/platform/settings", { token });
}

export function listOrganizationSettings(token: string, organizationId: string) {
  return fetchAdmin<OrganizationSetting[]>(
    `/organizations/${organizationId}/settings`,
    { token },
  );
}

export function saveOrganizationSettings(
  token: string,
  organizationId: string,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<OrganizationSetting[]>(
    `/organizations/${organizationId}/settings`,
    { body: settings, method: "PUT", token },
  );
}

export function saveSystemSettings(
  token: string,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<SystemSettingDto[]>("/platform/settings", { body: settings, method: "PUT", token });
}

export function listOrganizations(token: string) {
  return fetchAdmin<Organization[]>("/organizations", { token });
}

export function getOrganization(token: string, organizationId: string) {
  return fetchAdmin<Organization>(`/organizations/${organizationId}`, { token });
}

export function listOrganizationSettingsForOrganization(
  token: string,
  organizationId: string,
) {
  return fetchAdmin<OrganizationSetting[]>(
    `/organizations/${organizationId}/settings`,
    { token },
  );
}

export function saveOrganizationSettingsForOrganization(
  token: string,
  organizationId: string,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<OrganizationSetting[]>(
    `/organizations/${organizationId}/settings`,
    { body: settings, method: "PUT", token },
  );
}

export function updateOrganization(
  token: string,
  organizationId: string,
  payload: OrganizationPayload,
) {
  return fetchAdmin<Organization>(`/organizations/${organizationId}`, {
    body: payload,
    method: "PATCH",
    token,
  });
}

export function createOrganization(token: string, payload: OrganizationPayload) {
  return fetchAdmin<Organization>("/organizations", {
    body: payload,
    method: "POST",
    token,
  });
}

export function listOrganizationMembers(token: string, organizationId: string) {
  return fetchAdmin<OrganizationMembership[]>(
    `/organizations/${organizationId}/members`,
    { token },
  );
}

export function createOrganizationMember(
  token: string,
  organizationId: string,
  payload: OrganizationMembershipPayload,
) {
  return fetchAdmin<OrganizationMembership>(
    `/organizations/${organizationId}/members`,
    { body: payload, method: "POST", token },
  );
}

export function updateOrganizationMember(
  token: string,
  organizationId: string,
  membershipId: string,
  payload: OrganizationMembershipPayload,
) {
  return fetchAdmin<OrganizationMembership>(
    `/organizations/${organizationId}/members/${membershipId}`,
    { body: payload, method: "PATCH", token },
  );
}

export function deleteOrganizationMember(
  token: string,
  organizationId: string,
  membershipId: string,
) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/members/${membershipId}`,
    { method: "DELETE", token },
  );
}

export function listOrganizationGroups(token: string, organizationId: string) {
  return fetchAdmin<OrganizationGroup[]>(
    `/organizations/${organizationId}/groups`,
    { token },
  );
}

export function createOrganizationGroup(
  token: string,
  organizationId: string,
  payload: OrganizationGroupPayload,
) {
  return fetchAdmin<OrganizationGroup>(
    `/organizations/${organizationId}/groups`,
    { body: payload, method: "POST", token },
  );
}

export function getOrganizationGroup(
  token: string,
  organizationId: string,
  groupId: string,
) {
  return fetchAdmin<OrganizationGroup>(
    `/organizations/${organizationId}/groups/${groupId}`,
    { token },
  );
}

export function updateOrganizationGroup(
  token: string,
  organizationId: string,
  groupId: string,
  payload: OrganizationGroupPayload,
) {
  return fetchAdmin<OrganizationGroup>(
    `/organizations/${organizationId}/groups/${groupId}`,
    { body: payload, method: "PATCH", token },
  );
}

export function deleteOrganizationGroup(
  token: string,
  organizationId: string,
  groupId: string,
) {
  return fetchAdmin<void>(`/organizations/${organizationId}/groups/${groupId}`, {
    method: "DELETE",
    token,
  });
}

export function listOrganizationGroupMembers(
  token: string,
  organizationId: string,
  groupId: string,
) {
  return fetchAdmin<OrganizationGroupMember[]>(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    { token },
  );
}

export function replaceOrganizationGroupMembers(
  token: string,
  organizationId: string,
  groupId: string,
  membershipIds: string[],
) {
  return fetchAdmin<OrganizationGroupMember[]>(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    { body: { membershipIds }, method: "PUT", token },
  );
}

export function listOrganizationRoles(token: string, organizationId: string) {
  return fetchAdmin<Role[]>(`/organizations/${organizationId}/roles`, { token });
}

export function createOrganizationRole(
  token: string,
  organizationId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/organizations/${organizationId}/roles`, {
    body: payload,
    method: "POST",
    token,
  });
}

export function updateOrganizationRole(
  token: string,
  organizationId: string,
  roleId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/organizations/${organizationId}/roles/${roleId}`, {
    body: payload,
    method: "PATCH",
    token,
  });
}

export function replaceOrganizationRolePermissions(
  token: string,
  organizationId: string,
  roleId: string,
  permissions: Array<{ enabled?: boolean; permission?: string }>,
) {
  return fetchAdmin<RolePermission[]>(
    `/organizations/${organizationId}/roles/${roleId}/permissions`,
    { body: { permissions }, method: "PUT", token },
  );
}

export function deleteOrganizationRole(
  token: string,
  organizationId: string,
  roleId: string,
) {
  return fetchAdmin<void>(`/organizations/${organizationId}/roles/${roleId}`, {
    method: "DELETE",
    token,
  });
}

export function listPermissionCatalog(
  token: string,
  scope?: PermissionScope,
) {
  const suffix = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  return fetchAdmin<PermissionCatalog>(`/permissions/catalog${suffix}`, {
    token,
  });
}

export function listPlatformMembers(token: string) {
  return fetchAdmin<PlatformMember[]>("/platform/members", { token });
}

export function createPlatformMember(token: string, payload: PlatformMemberPayload) {
  return fetchAdmin<PlatformMember>("/platform/members", {
    body: payload,
    method: "POST",
    token,
  });
}

export function updatePlatformMember(
  token: string,
  memberId: string,
  payload: PlatformMemberPayload,
) {
  return fetchAdmin<PlatformMember>(`/platform/members/${memberId}`, {
    body: payload,
    method: "PATCH",
    token,
  });
}

export function deletePlatformMember(token: string, memberId: string) {
  return fetchAdmin<void>(`/platform/members/${memberId}`, {
    method: "DELETE",
    token,
  });
}

export function listPlatformRoles(token: string) {
  return fetchAdmin<Role[]>("/platform/roles", { token });
}

export function createPlatformRole(token: string, payload: RolePayload) {
  return fetchAdmin<Role>("/platform/roles", {
    body: payload,
    method: "POST",
    token,
  });
}

export function updatePlatformRole(
  token: string,
  roleId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/platform/roles/${roleId}`, {
    body: payload,
    method: "PATCH",
    token,
  });
}

export function replacePlatformRolePermissions(
  token: string,
  roleId: string,
  permissions: Array<{ enabled?: boolean; permission?: string }>,
) {
  return fetchAdmin<RolePermission[]>(`/platform/roles/${roleId}/permissions`, {
    body: { permissions },
    method: "PUT",
    token,
  });
}

export function deletePlatformRole(token: string, roleId: string) {
  return fetchAdmin<void>(`/platform/roles/${roleId}`, {
    method: "DELETE",
    token,
  });
}

export function listNotificationDestinationTypes(token: string, organizationId: string) {
  return fetchAdmin<NotificationDestinationType[]>(
    `/organizations/${organizationId}/notification-destinations/types`,
    { token },
  );
}

export function listNotificationDestinations(token: string, organizationId: string) {
  return fetchAdmin<NotificationDestination[]>(
    `/organizations/${organizationId}/notification-destinations`,
    { token },
  );
}

export function createNotificationDestination(token: string, organizationId: string, payload: {
  name: string;
  options?: Record<string, unknown> | null;
  type: string;
}) {
  return fetchAdmin<NotificationDestination>(
    `/organizations/${organizationId}/notification-destinations`,
    {
      body: payload,
      method: "POST",
      token,
    },
  );
}

export function updateNotificationDestination(
  token: string,
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
      token,
    },
  );
}

export function deleteNotificationDestination(token: string, organizationId: string, destinationId: string) {
  return fetchAdmin<void>(
    `/organizations/${organizationId}/notification-destinations/${destinationId}`,
    {
      method: "DELETE",
      token,
    },
  );
}

export function listNotificationDestinationGroups(token: string, organizationId: string, destinationId: string) {
  return fetchAdmin<NotificationDestinationGroup[]>(
    `/organizations/${organizationId}/notification-destinations/${destinationId}/groups`,
    { token },
  );
}
