import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import type { Invite, WorkspaceMember } from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function listWorkspaceMembers(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<WorkspaceMember[]>("/workspace/members", {});
}

export function updateWorkspaceMemberStatus(
  session: AuthenticatedAdminSessionMarker,
  membershipId: string,
  status: WorkspaceMember["status"],
  roleId?: string,
) {
  return fetchAdmin<WorkspaceMember>(
    `/workspace/members/${membershipId}/status`,
    { body: { roleId, status }, method: "PATCH" },
  );
}

export function removeWorkspaceMember(
  session: AuthenticatedAdminSessionMarker,
  membershipId: string,
) {
  return fetchAdmin<void>(`/workspace/members/${membershipId}`, {
    method: "DELETE",
  });
}

export function replaceWorkspaceMemberRole(
  session: AuthenticatedAdminSessionMarker,
  membershipId: string,
  roleId: string,
) {
  return fetchAdmin<WorkspaceMember>(`/workspace/members/${membershipId}/role`, {
    body: { roleId },
    method: "PUT",
  });
}

export function listInvites(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Invite[]>("/invites", {});
}

export function createInvite(
  session: AuthenticatedAdminSessionMarker,
  payload: {
    email: string;
    expiresIn?: "3d" | "7d" | "never";
    workspaceRoleId: string;
  },
) {
  return fetchAdmin<Invite>("/invites", {
    body: payload,
    method: "POST",
  });
}

export function resendInvite(
  session: AuthenticatedAdminSessionMarker,
  inviteId: string,
) {
  return fetchAdmin<Invite>(`/invites/${inviteId}/resend`, {
    method: "POST",
  });
}

export function revokeInvite(
  session: AuthenticatedAdminSessionMarker,
  inviteId: string,
) {
  return fetchAdmin<void>(`/invites/${inviteId}`, { method: "DELETE" });
}
