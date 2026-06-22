export type TenantStatus = "active" | "suspended";
export type OrganizationStatus = "active" | "suspended";
export type UserStatus = "active" | "disabled";

export type Tenant = {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  subdomain: string | null;
};

export type Organization = {
  id: string;
  isDefault: boolean;
  name: string;
  slug: string;
  status: OrganizationStatus;
  tenantId: string;
};

export type User = {
  displayName: string;
  email: string;
  firstName: string | null;
  id: string;
  lastName: string | null;
  roleId: string | null;
  status: UserStatus;
  tenantId: string;
  type: "service" | "user";
  username: string | null;
};

export type UserOrganization = {
  id: string;
  isActive: boolean;
  isDefault: boolean;
  organizationId: string;
  preferences: Record<string, unknown> | null;
  tenantId: string;
  userId: string;
};

export type Role = {
  id: string;
  isSystem: boolean;
  label: string;
  name: string;
  tenantId: string;
};

export type RolePermission = {
  enabled: boolean;
  id: string;
  permission: string;
  roleId: string;
  tenantId: string;
};

export type TenantSetting = {
  id: string;
  name: string;
  tenantId: string;
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
  membership: UserOrganization;
  organization: Organization;
  permissions: string[];
  role: Role | null;
  tenant: Tenant;
  user: User;
};

export type TenantSnapshot = {
  currentUser: CurrentUser;
  menus: Menu[];
  organizations: Organization[];
  rolePermissions: RolePermission[];
  roles: Role[];
  tenantSettings: TenantSetting[];
  tenants: Tenant[];
  userOrganizations: UserOrganization[];
  users: User[];
};

export type PublicBootstrap = {
  menus: Menu[];
  onboardingRequired: boolean;
  organizations: Organization[];
  tenants: Tenant[];
};

export type LoginResponse = {
  snapshot: TenantSnapshot;
  token: string;
};

export type OnboardingPayload = {
  adminEmail: string;
  adminName: string;
  adminPassword: string;
  organizationName: string;
  tenantName: string;
  tenantSlug?: string;
};

export type LoginPayload = {
  email: string;
  organizationId: string;
  password: string;
  tenantId: string;
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

export function loginAdmin(payload: LoginPayload) {
  return fetchAdmin<LoginResponse>("/login", {
    body: payload,
    method: "POST",
  });
}

export function onboardAdmin(payload: OnboardingPayload) {
  return fetchAdmin<LoginResponse>("/onboarding", {
    body: payload,
    method: "POST",
  });
}

export function getTenantSnapshot(token: string) {
  return fetchAdmin<TenantSnapshot>("/tenant-admin", { token });
}

export function buildMenuPermission(menuCode: string, action: "manage" | "view") {
  return `menu:${menuCode}:${action}`;
}
