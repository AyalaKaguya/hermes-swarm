import type {
  OrganizationStatus,
  TenantStatus,
  UserStatus,
} from "@hermes-swarm/core";

export type AdminSessionTokenPayload = {
  exp: number;
  organizationId: string;
  tenantId: string;
  userId: string;
};

export type AdminContext = {
  organizationId: string;
  permissions: string[];
  roleId: string | null;
  tenantId: string;
  userId: string;
};

export type AdminLoginPayload = {
  email?: string;
  organizationId?: string;
  password?: string;
  tenantId?: string;
};

export type OnboardingPayload = {
  adminEmail?: string;
  adminName?: string;
  adminPassword?: string;
  organizationName?: string;
  tenantName?: string;
  tenantSlug?: string;
};

export type CreateTenantPayload = {
  name?: string;
  slug?: string;
  status?: TenantStatus;
  subdomain?: string | null;
};

export type UpdateTenantPayload = Partial<CreateTenantPayload>;

export type CreateOrganizationPayload = {
  name?: string;
  slug?: string;
  status?: OrganizationStatus;
};

export type UpdateOrganizationPayload = Partial<CreateOrganizationPayload>;

export type CreateUserPayload = {
  displayName?: string;
  email?: string;
  password?: string;
  roleId?: string | null;
  status?: UserStatus;
};

export type UpdateUserPayload = Partial<CreateUserPayload>;

export type CreateMenuPayload = {
  code?: string;
  label?: string;
  path?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

export type UpdateMenuPayload = Partial<CreateMenuPayload>;

export type RolePermissionPayload = {
  enabled?: boolean;
  permission?: string;
};

export type ReplaceRolePermissionsPayload = {
  permissions?: RolePermissionPayload[];
};
