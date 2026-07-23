import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import {
  adminContracts,
  type CreatedIntegrationToken,
  type IntegrationToken,
  type IntegrationTokenCapabilities,
  type Invite,
  type User,
  type WorkspaceMember,
} from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function getIntegrationTokenCapabilities(
  session: AuthenticatedAdminSessionMarker,
) {
  return fetchAdmin<IntegrationTokenCapabilities>(
    "/account/integration-tokens/capabilities",
    {},
  );
}

export function listIntegrationTokens(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<IntegrationToken[]>("/account/integration-tokens", {});
}

export function createIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    expiresAt?: string;
    note?: string | null;
    permissions: string[];
  },
) {
  return fetchAdmin<CreatedIntegrationToken>("/account/integration-tokens", {
    body: payload,
    method: "POST",
  });
}

export function revokeIntegrationToken(
  session: AuthenticatedAdminSessionMarker,
  integrationTokenId: string,
) {
  return fetchAdmin<void>(`/account/integration-tokens/${integrationTokenId}`, {
    method: "DELETE",
  });
}

export function validateInvite(email: string | null | undefined, token: string) {
  return fetchAdmin<Invite>("/invites/validate", {
    body: { email, token },
    method: "POST",
  });
}

export function acceptInvite(payload: {
  action?: "accept" | "decline";
  displayName?: string;
  email?: string;
  password?: string;
  token?: string;
}) {
  return fetchAdmin<Invite>("/invites/accept", {
    body: payload,
    method: "POST",
  });
}

export function fetchMe(session?: AuthenticatedAdminSessionMarker) {
  return fetchAdmin(adminContracts.authMe);
}

export function searchUsers(
  session: AuthenticatedAdminSessionMarker,
  search: string,
) {
  const suffix = search.trim()
    ? `?search=${encodeURIComponent(search.trim())}`
    : "";
  return fetchAdmin<WorkspaceMember[]>(`/workspace/members/search${suffix}`, {});
}

export function fetchAccount() {
  return fetchAdmin<User>("/account");
}

export function updateUser(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    displayName?: string;
    email?: string;
    firstName?: string | null;
    imageUrl?: string | null;
    lastName?: string | null;
    mobile?: string | null;
    username?: string | null;
  },
) {
  return fetchAdmin<User>("/account", { body: payload, method: "PATCH" });
}

export function updateUserPassword(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    currentPassword: string;
    password: string;
  },
) {
  return fetchAdmin<void>("/account/password", {
    body: payload,
    method: "PATCH",
  });
}

export function updateUserPreferredLanguage(
  session: AuthenticatedAdminSessionMarker,
  preferredLanguage: string | null,
) {
  return fetchAdmin<User>("/account/preferences", {
    body: { preferredLanguage },
    method: "PATCH",
  });
}

export function updateUserRuntimePreferences(
  session: AuthenticatedAdminSessionMarker,
  payload: { preferredLanguage?: string | null; timeZone?: string | null },
) {
  return fetchAdmin<User>("/account/preferences", {
    body: payload,
    method: "PATCH",
  });
}
