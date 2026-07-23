import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import {
  adminContracts,
  type AuthenticatedLoginResponse,
  type AuthRefreshResponse,
  type AuthSessionDevice,
  type LoginRequest as LoginPayload,
  type OnboardingPayload,
  type RealtimeTicketResponse,
  type ResumeOnboardingPayload,
} from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function authLogin(payload: LoginPayload) {
  return fetchAdmin(adminContracts.authLogin, {
    body: payload,
  });
}

export function selectLoginContext(payload: {
  contextType: "platform" | "workspace";
  membershipId: string;
  selectionToken: string;
}) {
  return fetchAdmin(adminContracts.authSelectContext, {
    body: payload,
  });
}

export function listAccountContexts() {
  return fetchAdmin(adminContracts.authContexts);
}

export function switchAccountContext(payload: {
  contextType: "platform" | "workspace";
  membershipId: string;
}) {
  return fetchAdmin(adminContracts.authSwitchContext, {
    body: payload,
  });
}

export function resolveWorkspaceLoginContext(workspace?: string) {
  return fetchAdmin(adminContracts.authWorkspaceContext, {
    body: workspace ? { workspace } : {},
  });
}

export function onboard(payload: OnboardingPayload) {
  return fetchAdmin<AuthenticatedLoginResponse>("/onboarding", {
    body: payload,
    method: "POST",
  });
}

export function resumeOnboarding(payload: ResumeOnboardingPayload) {
  return fetchAdmin<AuthenticatedLoginResponse>("/onboarding/resume", {
    body: payload,
    method: "POST",
  });
}

export async function refreshAuthSession() {
  return fetchAdmin<AuthRefreshResponse>("/auth/refresh", {
    method: "POST",
  });
}

export async function logoutAuthSession() {
  await fetchAdmin<void>("/auth/logout", { method: "POST" }).catch(
    () => undefined,
  );
}

export function createRealtimeTicket() {
  return fetchAdmin<RealtimeTicketResponse>("/auth/realtime-ticket", {
    method: "POST",
  });
}

export function requestPasswordReset(email: string, workspaceSlug?: string) {
  return fetchAdmin<{ success: boolean }>("/auth/request-password", {
    body: { email, workspaceSlug },
    method: "POST",
  });
}

export function resetPassword(payload: {
  confirmPassword?: string;
  email?: string;
  password?: string;
  token?: string;
}) {
  return fetchAdmin<{ success: boolean }>("/auth/reset-password", {
    body: payload,
    method: "POST",
  });
}

export function listAuthSessions(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<AuthSessionDevice[]>("/auth/sessions", {});
}

export function revokeAuthSession(
  session: AuthenticatedAdminSessionMarker,
  sessionId: string,
) {
  return fetchAdmin<void>(`/auth/sessions/${sessionId}`, {
    method: "DELETE",
  });
}

export function deleteAuthSessionRecord(
  session: AuthenticatedAdminSessionMarker,
  sessionId: string,
) {
  return fetchAdmin<void>(`/auth/sessions/${sessionId}/record`, {
    method: "DELETE",
  });
}

export function revokeOtherAuthSessions(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<void>("/auth/sessions", {
    method: "DELETE",
  });
}
