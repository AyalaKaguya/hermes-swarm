import type {
  Invite,
  LoginRequest,
} from "@hermes-swarm/api-contracts";

/** Private payload stored inside the signed admin session token. */
export type AuthSessionTokenPayload = {
  accountId?: string | null;
  credentialVersion: number;
  exp: number;
  kid: string;
  jti: string;
  membershipId?: string | null;
  principalType: "integration" | "platform" | "workspace";
  sessionId: string;
  workspaceId: string | null;
  userId: string;
};

/** Internal mapper alias; the HTTP form is defined by the shared Invite schema. */
export type InviteDto = Invite;
export type LoginPayload = LoginRequest;

export type {
  AcceptInvitePayload,
  CreateIntegrationTokenPayload,
  CreateInvitePayload,
  OnboardingPayload,
  ReplaceRolePermissionsPayload,
  RequestPasswordResetPayload,
  ResetPasswordPayload,
  SaveSettingsPayload,
  SearchUsersQuery,
  SelectContextPayload,
  UpdateAccountPasswordPayload,
  UpdateRuntimePreferencesPayload,
  UpdateSelfProfilePayload,
} from "@hermes-swarm/api-contracts";
