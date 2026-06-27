import type {
  OrganizationStatus,
  UserStatus,
} from "@hermes-swarm/core";

/**
 * Payload stored inside the admin session token.
 */
export type AuthSessionTokenPayload = {
  exp: number;
  organizationId: string;
  userId: string;
};

/**
 * Authorization context resolved from the admin session token.
 */
export type AuthContext = {
  organizationId: string;
  permissions: string[];
  roleId: string | null;
  userId: string;
};

/**
 * Credentials used by both the legacy admin login route and the auth module.
 */
export type LoginPayload = {
  email?: string;
  password?: string;
};

/**
 * Initial onboarding payload for the very first organization and admin user.
 */
export type OnboardingPayload = {
  adminEmail?: string;
  adminName?: string;
  adminPassword?: string;
  organizationName?: string;
  organizationSlug?: string;
};

/**
 * Organization creation and update payload shared by organization routes.
 */
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

/**
 * Organization update payload shape.
 */
export type UpdateOrganizationPayload = Partial<CreateOrganizationPayload>;

/**
 * User creation payload for the migrated admin user management module.
 */
export type CreateUserPayload = {
  displayName?: string;
  email?: string;
  imageUrl?: string | null;
  password?: string;
  roleId?: string | null;
  status?: UserStatus;
};

/**
 * User update payload shape.
 */
export type UpdateUserPayload = Partial<CreateUserPayload>;

/**
 * Search query used by the user search endpoint.
 */
export type SearchUsersQuery = {
  search?: string;
};

/**
 * Password change payload for both self-service and admin flows.
 */
export type UpdateUserPasswordPayload = {
  currentPassword?: string;
  password?: string;
};

/**
 * Preferred language payload for self-service profile updates.
 */
export type UpdatePreferredLanguagePayload = {
  preferredLanguage?: string;
};

/**
 * Organization and system settings payload shape accepted by the settings API.
 */
export type SaveSettingsPayload =
  | Record<string, string | number | boolean | null | undefined>
  | {
      settings?: Array<{
        name?: string;
        value?: string | number | boolean | null;
    }>;
    };

/**
 * Admin menu creation payload.
 */
export type CreateMenuPayload = {
  code?: string;
  label?: string;
  path?: string;
  parentId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
};

/**
 * Admin menu update payload.
 */
export type UpdateMenuPayload = Partial<CreateMenuPayload>;

/**
 * Individual role permission payload entry.
 */
export type RolePermissionPayload = {
  enabled?: boolean;
  permission?: string;
};

/**
 * Batch permission replacement payload for a role.
 */
export type ReplaceRolePermissionsPayload = {
  permissions?: RolePermissionPayload[];
};

/**
 * Active organization switch payload.
 */
export type SwitchOrganizationPayload = {
  organizationId?: string;
};

/**
 * Bulk invite creation payload.
 */
export type CreateBulkInvitesPayload = {
  emailIds?: string[];
  roleId?: string;
  invitedById?: string;
};

/**
 * Invite acceptance payload for user registration.
 */
export type AcceptInvitePayload = {
  email?: string;
  token?: string;
  password?: string;
  displayName?: string;
};

/**
 * Invite DTO output.
 */
export type InviteDto = {
  id: string;
  email: string;
  token?: string;
  status: "invited" | "accepted" | "expired" | "revoked";
  createdAt: Date;
  actionDate: Date | null;
  expireDate: Date | null;
  roleId: string | null;
  invitedById: string | null;
};

/**
 * Payload for requesting a password reset by email.
 */
export type RequestPasswordResetPayload = {
  email?: string;
};

/**
 * Payload for resetting a password with a token.
 */
export type ResetPasswordPayload = {
  email?: string;
  token?: string;
  password?: string;
  confirmPassword?: string;
};
