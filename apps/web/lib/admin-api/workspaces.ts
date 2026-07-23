import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import type {
  AuditLogPage,
  AuditLogQuery,
  LoginAuditLogItem,
  OperationAuditLogItem,
  User,
  Workspace,
  WorkspaceApplication,
  WorkspaceApplicationApproval,
  WorkspaceApplicationPayload,
  WorkspaceApplicationSubmission,
} from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function submitWorkspaceApplication(payload: WorkspaceApplicationPayload) {
  return fetchAdmin<WorkspaceApplicationSubmission>("/workspace-applications", {
    body: payload,
    method: "POST",
  });
}

export function verifyWorkspaceApplication(applicationId: string, token: string) {
  return fetchAdmin<WorkspaceApplication>(
    `/workspace-applications/${applicationId}/verify`,
    { body: { token }, method: "POST" },
  );
}

export function cancelWorkspaceApplication(applicationId: string, token: string) {
  return fetchAdmin<WorkspaceApplication>(
    `/workspace-applications/${applicationId}/cancel`,
    { body: { token }, method: "POST" },
  );
}

export function activateWorkspaceOwner(payload: {
  displayName?: string;
  password?: string;
  token: string;
}) {
  return fetchAdmin<{
    account: Pick<User, "displayName" | "email" | "id">;
    existingAccount: boolean;
    membershipId: string;
    workspace: Workspace;
  }>("/workspace-applications/activate-owner", {
    body: payload,
    method: "POST",
  });
}

export function listWorkspaceApplications(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<WorkspaceApplication[]>("/platform/workspace-applications", {});
}

export function listPlatformWorkspaces(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Workspace[]>("/platform/workspaces", {});
}

export function listLoginAuditLogs(
  session: AuthenticatedAdminSessionMarker,
  scope: "platform" | "workspace",
  query: AuditLogQuery,
) {
  return fetchAdmin<AuditLogPage<LoginAuditLogItem>>(
    `${auditApiBase(scope)}/login-logs${buildQueryString(query)}`,
  );
}

export function listOperationAuditLogs(
  session: AuthenticatedAdminSessionMarker,
  scope: "platform" | "workspace",
  query: AuditLogQuery,
) {
  return fetchAdmin<AuditLogPage<OperationAuditLogItem>>(
    `${auditApiBase(scope)}/operation-logs${buildQueryString(query)}`,
  );
}

function auditApiBase(scope: "platform" | "workspace") {
  return scope === "platform" ? "/platform/audit" : "/workspace/audit";
}

function buildQueryString(query: AuditLogQuery) {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    parameters.set(key, String(value));
  }
  const queryString = parameters.toString();
  return queryString ? `?${queryString}` : "";
}

export function updatePlatformWorkspaceStatus(
  session: AuthenticatedAdminSessionMarker,
  workspaceId: string,
  status: "active" | "archived" | "suspended",
) {
  return fetchAdmin<Workspace>(`/platform/workspaces/${workspaceId}/status`, {
    body: { status },
    method: "PATCH",
  });
}

export function approveWorkspaceApplication(
  session: AuthenticatedAdminSessionMarker,
  applicationId: string,
  payload: { note?: string | null },
) {
  return fetchAdmin<WorkspaceApplicationApproval>(
    `/platform/workspace-applications/${applicationId}/approve`,
    { body: payload, method: "POST" },
  );
}

export function rejectWorkspaceApplication(
  session: AuthenticatedAdminSessionMarker,
  applicationId: string,
  payload: { note?: string | null },
) {
  return fetchAdmin<WorkspaceApplication>(
    `/platform/workspace-applications/${applicationId}/reject`,
    { body: payload, method: "POST" },
  );
}
