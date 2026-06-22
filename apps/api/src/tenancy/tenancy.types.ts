import type {
  OrganizationStatus,
  UserStatus,
} from "@hermes-swarm/core";

export type AuthSessionTokenPayload = {
  exp: number;
  organizationId: string;
  userId: string;
};

export type AuthContext = {
  organizationId: string;
  permissions: string[];
  roleId: string | null;
  userId: string;
};

export type LoginPayload = {
  email?: string;
  password?: string;
};

export type OnboardingPayload = {
  adminEmail?: string;
  adminName?: string;
  adminPassword?: string;
  organizationName?: string;
  organizationSlug?: string;
};

export type CreateOrganizationPayload = {
  name?: string;
  slug?: string;
  status?: OrganizationStatus;
  subdomain?: string | null;
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
