import type { IntegrationToken } from "@hermes-swarm/core";

export type AuthRequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type AuthSessionRecord = {
  accountId: string | null;
  browser: string;
  credentialVersion: number;
  createdAt: string;
  deviceLabel: string;
  expiresAt: string;
  ipAddress: string | null;
  lastSeenAt: string;
  membershipId: string | null;
  os: string;
  principalType: "platform" | "workspace";
  refreshTokenHash: string;
  revokedAt: string | null;
  sessionId: string;
  workspaceId: string | null;
  userAgent: string | null;
  userId: string;
};

export type ValidatedAuthSession = {
  accountId: string | null;
  integrationToken?: {
    id: string;
    permissions: string[];
    scope: IntegrationToken["scope"];
    workspaceId: string;
  } | null;
  jti: string;
  membershipId: string | null;
  principalType: "integration" | "platform" | "workspace";
  record: AuthSessionRecord;
  sessionId: string;
  workspaceId: string | null;
  tokenKind: "integration" | "session";
  userId: string;
};

export type IssuedAuthSession = {
  accessToken: string;
  expiresAt: string;
  principalType: "platform" | "workspace";
  refreshToken: string;
  sessionId: string;
  workspaceId: string | null;
};

export type RealtimeTicketSession = {
  sessionId: string;
  workspaceId: string;
  userId: string;
};

export type ContextSelectionRecord = {
  accountId: string;
  credentialVersion: number;
  contextMembershipIds: string[];
  expiresAt: string;
};

export type RefreshRotationResult = IssuedAuthSession & {
  workspaceId: string | null;
  userId: string;
};
