export type OrganizationStatus = "active" | "suspended";
export type RequestScopeLevel = "organization" | "platform";
export type UserStatus = "active" | "disabled";

export type Organization = {
  banner: string | null;
  brandColor: string | null;
  clientFocus: string | null;
  currency: string | null;
  dateFormat: string | null;
  id: string;
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

export type Tag = {
  category: string | null;
  color: string | null;
  description: string | null;
  icon: string | null;
  id: string;
  isSystem: boolean;
  label: Record<string, unknown> | null;
  name: string;
  organizationId: string | null;
};

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
  preferredLanguage: string;
  emailVerified: boolean;
  timeZone: string | null;
  roleId: string | null;
  status: UserStatus;
  organizationId: string | null;
  type: "service" | "user";
  createdAt: string;
  updatedAt: string;
};

export type Role = {
  id: string;
  isSystem: boolean;
  label: string;
  name: string;
  organizationId: string;
};

export type RolePermission = {
  id: string;
  enabled: boolean;
  permission: string;
  roleId: string;
  organizationId: string;
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
  name: string;
  organizationId: string;
  value: string | null;
};

export type SystemSettingDto = {
  id: string;
  name: string;
  scope: string;
  value: string | null;
};

export type Menu = {
  id: string;
  parentId: string | null;
  code: string;
  label: string;
  path: string;
  sortOrder: number;
  isActive: boolean;
};

export type MenuPayload = {
  code?: string;
  label?: string;
  path?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type CurrentUser = {
  isPlatformAdmin?: boolean;
  organization: Organization;
  permissions: string[];
  role: Role | null;
  user: User;
};

export type Snapshot = {
  currentUser: CurrentUser;
  isPlatformAdmin: boolean;
  menus: Menu[];
  organization: Organization;
  organizations: Organization[];
  rolePermissions: RolePermission[];
  roles: Role[];
  scope: {
    level: RequestScopeLevel;
    organizationId: string | null;
  };
  settings: OrganizationSetting[];
  systemSettings: SystemSettingDto[];
  users: User[];
};

export type PublicBootstrap = {
  menus: Menu[];
  onboardingRequired: boolean;
  organizations: Organization[];
};

export type LoginResponse = {
  snapshot: Snapshot;
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

  const response = await fetch(`${ADMIN_API_BASE_URL}${path}`, {
    method: options?.method ?? "GET",
    headers,
    body: options?.body === undefined ? undefined : JSON.stringify(options.body),
  });

  if (!response.ok) {
    const detail = await response.json().catch(() => undefined);
    const message = Array.isArray(detail?.message)
      ? detail.message.join(", ")
      : detail?.message;
    throw new Error(message || `请求失败：${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  if (!text) {
    return null as T;
  }

  return JSON.parse(text) as T;
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

export function login(payload: LoginPayload) {
  return fetchAdmin<LoginResponse>("/login", {
    body: payload,
    method: "POST",
  });
}

export function onboard(payload: OnboardingPayload) {
  return fetchAdmin<LoginResponse>("/onboarding", {
    body: payload,
    method: "POST",
  });
}

export function getSnapshot(token: string) {
  return fetchAdmin<Snapshot>("/snapshot", { token });
}

export function switchOrganizationScope(token: string, organizationId: string) {
  return fetchAdmin<LoginResponse>("/scope/organization", {
    body: { organizationId },
    method: "POST",
    token,
  });
}

export function switchPlatformScope(token: string) {
  return fetchAdmin<LoginResponse>("/scope/platform", {
    method: "POST",
    token,
  });
}

export function getInvites(token: string) {
  return fetchAdmin<Invite[]>("/invites", { token });
}

export function resendInvite(token: string, inviteId: string) {
  return fetchAdmin<Invite>(`/invites/${inviteId}/resend`, {
    method: "POST",
    token,
  });
}

export function deleteInvite(token: string, inviteId: string) {
  return fetchAdmin<void>(`/invites/${inviteId}`, {
    method: "DELETE",
    token,
  });
}

export function buildMenuPermission(menuCode: string, action: "manage" | "view") {
  return `menu:${menuCode}:${action}`;
}

export function listMenus(token: string, options: { includeInactive?: boolean } = {}) {
  const search = options.includeInactive ? "?includeInactive=true" : "";
  return fetchAdmin<Menu[]>(`/menus${search}`, { token });
}

export function createMenu(token: string, payload: MenuPayload) {
  return fetchAdmin<Menu>("/menus", { body: payload, method: "POST", token });
}

export function updateMenu(token: string, menuId: string, payload: MenuPayload) {
  return fetchAdmin<Menu>(`/menus/${menuId}`, { body: payload, method: "PATCH", token });
}

export function deleteMenu(token: string, menuId: string) {
  return fetchAdmin<Menu>(`/menus/${menuId}`, { method: "DELETE", token });
}

export function replaceRolePermissions(
  token: string,
  roleId: string,
  permissions: Array<{ enabled: boolean; permission: string }>,
) {
  return fetchAdmin<RolePermission[]>(`/roles/${roleId}/permissions`, {
    body: { permissions },
    method: "PUT",
    token,
  });
}

export function fetchMe(token: string) {
  return fetchAdmin<CurrentUser>("/auth/me", { token });
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

export type GroupDto = {
  id: string;
  name: string;
  description: string | null;
  organizationId: string;
  memberIds: string[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateInviteResult = {
  items: Invite[];
  total: number;
  ignored: number;
};

export function getSmtpConfig(token: string) {
  return fetchAdmin<SmtpConfig | null>("/mail/smtp", { token });
}

export function saveSmtpConfig(token: string, payload: {
  fromAddress?: string | null;
  host?: string;
  isValidated?: boolean;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}) {
  return fetchAdmin<SmtpConfig>("/mail/smtp", { body: payload, method: "PUT", token });
}

export function validateSmtpConfig(token: string, payload: {
  fromAddress?: string | null;
  host?: string;
  password?: string | null;
  port?: number;
  secure?: boolean;
  username?: string | null;
}) {
  return fetchAdmin<{ ok: boolean }>("/mail/smtp/validate", { body: payload, method: "POST", token });
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
  return fetchAdmin<User>(`/users/${userId}`, { body: payload, method: "PATCH", token });
}

export function createInvites(token: string, payload: {
  emailIds: string[];
  roleId?: string;
}) {
  return fetchAdmin<CreateInviteResult>("/invites", { body: payload, method: "POST", token });
}

export function listEmailTemplates(token: string) {
  return fetchAdmin<EmailTemplateDto[]>("/mail/templates", { token });
}

export function createEmailTemplate(token: string, payload: {
  hbs: string;
  languageCode: string;
  mjml?: string | null;
  name: string;
  subject?: string | null;
}) {
  return fetchAdmin<EmailTemplateDto>("/mail/templates", { body: payload, method: "POST", token });
}

export function updateEmailTemplate(token: string, templateId: string, payload: Partial<{
  hbs: string;
  languageCode: string;
  mjml: string | null;
  name: string;
  subject: string | null;
}>) {
  return fetchAdmin<EmailTemplateDto>(`/mail/templates/${templateId}`, { body: payload, method: "PATCH", token });
}

export function deleteEmailTemplate(token: string, templateId: string) {
  return fetchAdmin<void>(`/mail/templates/${templateId}`, { method: "DELETE", token });
}

export function listSystemSettings(token: string) {
  return fetchAdmin<SystemSettingDto[]>("/system-settings", { token });
}

export function listOrganizationSettings(token: string) {
  return fetchAdmin<OrganizationSetting[]>("/settings", { token });
}

export function saveOrganizationSettings(
  token: string,
  settings:
    | Record<string, string | number | boolean | null>
    | { settings: Array<{ name: string; value: string | number | boolean | null }> },
) {
  return fetchAdmin<OrganizationSetting[]>("/settings", { body: settings, method: "PUT", token });
}

export function saveSystemSettings(
  token: string,
  settings:
    | Record<string, string | number | boolean | null>
    | { settings: Array<{ name: string; value: string | number | boolean | null }> },
) {
  return fetchAdmin<SystemSettingDto[]>("/system-settings", { body: settings, method: "PUT", token });
}

export function listGroups(token: string) {
  return fetchAdmin<GroupDto[]>("/groups", { token });
}

export function createGroup(token: string, payload: {
  name: string;
  description?: string | null;
}) {
  return fetchAdmin<GroupDto>("/groups", { body: payload, method: "POST", token });
}

export function updateGroup(token: string, groupId: string, payload: {
  name?: string;
  description?: string | null;
}) {
  return fetchAdmin<GroupDto>(`/groups/${groupId}`, { body: payload, method: "PATCH", token });
}

export function updateGroupMembers(token: string, groupId: string, userIds: string[]) {
  return fetchAdmin<GroupDto>(`/groups/${groupId}/members`, {
    body: { userIds },
    method: "PUT",
    token,
  });
}

export function deleteGroup(token: string, groupId: string) {
  return fetchAdmin<void>(`/groups/${groupId}`, { method: "DELETE", token });
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
  settings:
    | Record<string, string | number | boolean | null>
    | { settings: Array<{ name: string; value: string | number | boolean | null }> },
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

export function listOrganizationUsers(token: string, organizationId: string) {
  return fetchAdmin<User[]>(`/organizations/${organizationId}/users`, { token });
}

export function createOrganizationUser(
  token: string,
  organizationId: string,
  payload: {
    displayName?: string;
    email?: string;
    password?: string;
    roleId?: string | null;
    status?: UserStatus;
  },
) {
  return fetchAdmin<User>(`/organizations/${organizationId}/users`, {
    body: payload,
    method: "POST",
    token,
  });
}

export function updateOrganizationUser(
  token: string,
  organizationId: string,
  userId: string,
  payload: {
    displayName?: string;
    email?: string;
    roleId?: string | null;
    status?: UserStatus;
  },
) {
  return fetchAdmin<User>(`/organizations/${organizationId}/users/${userId}`, {
    body: payload,
    method: "PATCH",
    token,
  });
}

export function listOrganizationRoles(token: string, organizationId: string) {
  return fetchAdmin<Role[]>(`/organizations/${organizationId}/roles`, { token });
}

export function listOrganizationGroups(token: string, organizationId: string) {
  return fetchAdmin<GroupDto[]>(`/organizations/${organizationId}/groups`, { token });
}

export function createOrganizationGroup(
  token: string,
  organizationId: string,
  payload: {
    name: string;
    description?: string | null;
  },
) {
  return fetchAdmin<GroupDto>(`/organizations/${organizationId}/groups`, {
    body: payload,
    method: "POST",
    token,
  });
}

export function updateOrganizationGroup(
  token: string,
  organizationId: string,
  groupId: string,
  payload: {
    name?: string;
    description?: string | null;
  },
) {
  return fetchAdmin<GroupDto>(
    `/organizations/${organizationId}/groups/${groupId}`,
    { body: payload, method: "PATCH", token },
  );
}

export function updateOrganizationGroupMembers(
  token: string,
  organizationId: string,
  groupId: string,
  userIds: string[],
) {
  return fetchAdmin<GroupDto>(
    `/organizations/${organizationId}/groups/${groupId}/members`,
    {
      body: { userIds },
      method: "PUT",
      token,
    },
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

export function listTags(token: string) {
  return fetchAdmin<Tag[]>("/tags", { token });
}

export function createTag(token: string, payload: {
  category?: string | null;
  color?: string | null;
  description?: string | null;
  icon?: string | null;
  name: string;
}) {
  return fetchAdmin<Tag>("/tags", { body: payload, method: "POST", token });
}

export function updateTag(token: string, tagId: string, payload: Partial<{
  category: string | null;
  color: string | null;
  description: string | null;
  icon: string | null;
  name: string;
}>) {
  return fetchAdmin<Tag>(`/tags/${tagId}`, { body: payload, method: "PATCH", token });
}

export function deleteTag(token: string, tagId: string) {
  return fetchAdmin<void>(`/tags/${tagId}`, { method: "DELETE", token });
}

export function listNotificationDestinationTypes(token: string) {
  return fetchAdmin<NotificationDestinationType[]>("/notification-destinations/types", { token });
}

export function listNotificationDestinations(token: string) {
  return fetchAdmin<NotificationDestination[]>("/notification-destinations", { token });
}

export function createNotificationDestination(token: string, payload: {
  name: string;
  options?: Record<string, unknown> | null;
  type: string;
}) {
  return fetchAdmin<NotificationDestination>("/notification-destinations", {
    body: payload,
    method: "POST",
    token,
  });
}

export function updateNotificationDestination(
  token: string,
  destinationId: string,
  payload: Partial<{
    name: string;
    options: Record<string, unknown> | null;
    type: string;
  }>,
) {
  return fetchAdmin<NotificationDestination>(`/notification-destinations/${destinationId}`, {
    body: payload,
    method: "PATCH",
    token,
  });
}

export function deleteNotificationDestination(token: string, destinationId: string) {
  return fetchAdmin<void>(`/notification-destinations/${destinationId}`, {
    method: "DELETE",
    token,
  });
}

export function listNotificationDestinationGroups(token: string, destinationId: string) {
  return fetchAdmin<NotificationDestinationGroup[]>(
    `/notification-destinations/${destinationId}/groups`,
    { token },
  );
}
