import type {
  IntegrationTokenScope,
  OrganizationStatus,
  SettingValueOption,
  SettingValueType,
  UserStatus,
} from "@hermes-swarm/core";

/**
 * Payload stored inside the admin session token.
 */
export type AuthSessionTokenPayload = {
  exp: number;
  jti: string;
  sessionId: string;
  userId: string;
};

export type LoginResponseDto = {
  accessToken: string;
  expiresAt: string;
  sessionId: string;
  snapshot: unknown;
};

export type RefreshSessionResponseDto = {
  accessToken: string;
  expiresAt: string;
  sessionId: string;
};

export type AuthSessionDeviceDto = {
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

export type CreateIntegrationTokenPayload = {
  expiresAt?: string;
  note?: string | null;
  organizationId?: string | null;
  permissions?: string[];
  scope?: IntegrationTokenScope;
};

/**
 * Credentials used by the admin auth module.
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
  firstName?: string | null;
  imageUrl?: string | null;
  lastName?: string | null;
  mobile?: string | null;
  password?: string;
  roleId?: string | null;
  status?: UserStatus;
  username?: string | null;
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

export type SettingPayloadValue =
  | string
  | number
  | boolean
  | Record<string, unknown>
  | unknown[]
  | null
  | undefined;

/**
 * Organization and system settings payload shape accepted by the settings API.
 */
export type SaveSettingsPayload =
  | Record<string, SettingPayloadValue>
  | {
      settings?: Array<{
        name?: string;
        value?: SettingPayloadValue;
        valueOptions?: SettingValueOption[] | null;
        valueType?: SettingValueType;
      }>;
    };

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

export type PermissionCatalogDto = {
  scopes: Array<{
    entities: Array<{
      entity: string;
      label: string;
      order?: number | null;
      purposes: Array<{
        label: string;
        operations: Array<{
          description?: string | null;
          isDangerous?: boolean;
          label: string;
          operation: string;
          order?: number | null;
          permission: string;
        }>;
        order?: number | null;
        purpose: string;
      }>;
    }>;
    label: string;
    scope: "platform" | "organization" | "own";
  }>;
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
