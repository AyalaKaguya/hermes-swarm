import type {
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
  principalType: "integration" | "platform" | "tenant";
  sessionId: string;
  tenantId: string | null;
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
  permissions?: string[];
};

/**
 * Credentials used by the admin auth module.
 */
export type LoginPayload = {
  email?: string;
  password?: string;
  tenantSlug?: string;
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
  name?: string;
  parentOrganizationId?: string | null;
  slug?: string;
  status?: OrganizationStatus;
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
  preferredLanguage?: string | null;
};

export type UpdateRuntimePreferencesPayload = {
  preferredLanguage?: string | null;
  timeZone?: string | null;
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
        scope?: "platform" | "tenant";
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
    scope: "platform" | "tenant" | "organization" | "own";
  }>;
};

/**
 * Bulk invite creation payload.
 */
export type CreateInvitePayload = {
  email?: string;
  expiresIn?: "3d" | "7d" | "never";
  workspaceRoleId?: string;
  organizations?: Array<{
    isDefault?: boolean;
    organizationId?: string;
    roleId?: string;
  }>;
};

/**
 * Invite acceptance payload for user registration.
 */
export type AcceptInvitePayload = {
  action?: "accept" | "decline";
  email?: string;
  token?: string;
  password?: string;
  displayName?: string;
};

/**
 * Invite DTO output.
 */
export type InviteDto = {
  acceptedCount: number;
  acceptedUserId: string | null;
  closedAt: Date | null;
  id: string;
  email: string | null;
  existingUser?: boolean;
  link?: string;
  organizationAssignments: Array<{
    isDefault?: boolean;
    organizationId: string;
    roleId: string;
  }>;
  invitedBy?: {
    avatarUrl: string | null;
    displayName: string;
    email: string;
    id: string;
    imageUrl: string | null;
    username: string | null;
  } | null;
  workspaceRoleId: string;
  token?: string;
  status: "invited" | "accepted" | "declined" | "expired" | "revoked";
  createdAt: Date;
  actionDate: Date | null;
  expireDate: Date | null;
  invitedById: string | null;
};

/**
 * Payload for requesting a password reset by email.
 */
export type RequestPasswordResetPayload = {
  email?: string;
  tenantSlug?: string;
};

/**
 * Payload for resetting a password with a token.
 */
export type ResetPasswordPayload = {
  email?: string;
  token?: string;
  password?: string;
  tenantSlug?: string;
  confirmPassword?: string;
};
