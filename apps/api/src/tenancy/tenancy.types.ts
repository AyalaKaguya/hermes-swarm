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
  banner?: string | null;
  brandColor?: string | null;
  clientFocus?: string | null;
  currency?: string | null;
  dateFormat?: string | null;
  imageUrl?: string | null;
  isDefault?: boolean;
  name?: string;
  officialName?: string | null;
  overview?: string | null;
  preferredLanguage?: string | null;
  profileLink?: string | null;
  regionCode?: string | null;
  shortDescription?: string | null;
  slug?: string;
  status?: OrganizationStatus;
  subdomain?: string | null;
  timeZone?: string | null;
  totalEmployees?: number | null;
  website?: string | null;
};

export type UpdateOrganizationPayload = Partial<CreateOrganizationPayload>;

export type CreateUserPayload = {
  displayName?: string;
  email?: string;
  imageUrl?: string | null;
  password?: string;
  roleId?: string | null;
  status?: UserStatus;
};

export type UpdateUserPayload = Partial<CreateUserPayload>;

export type SearchUsersQuery = {
  search?: string;
};

export type UpdateUserPasswordPayload = {
  currentPassword?: string;
  password?: string;
};

export type UpdatePreferredLanguagePayload = {
  preferredLanguage?: string;
};

export type SaveSettingsPayload =
  | Record<string, string | number | boolean | null | undefined>
  | {
      settings?: Array<{
        name?: string;
        value?: string | number | boolean | null;
      }>;
    };

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
