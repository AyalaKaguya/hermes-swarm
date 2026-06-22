export type OrganizationStatus = "active" | "suspended";
export type UserStatus = "active" | "disabled";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  status: OrganizationStatus;
  subdomain: string | null;
};

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

export type OrganizationSetting = {
  id: string;
  name: string;
  organizationId: string;
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

export type CurrentUser = {
  organization: Organization;
  permissions: string[];
  role: Role | null;
  user: User;
};

export type Snapshot = {
  currentUser: CurrentUser;
  menus: Menu[];
  organization: Organization;
  organizations: Organization[];
  rolePermissions: RolePermission[];
  roles: Role[];
  settings: OrganizationSetting[];
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

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3100/api";
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

  return response.json() as Promise<T>;
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

export function buildMenuPermission(menuCode: string, action: "manage" | "view") {
  return `menu:${menuCode}:${action}`;
}
