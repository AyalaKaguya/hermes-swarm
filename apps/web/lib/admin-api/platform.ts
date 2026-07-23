import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import type {
  PermissionCatalog,
  PlatformMember,
  PlatformMemberInvitation,
  PlatformMemberPayload,
  Role,
  RolePayload,
  RolePermission,
} from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function listPlatformPermissionCatalog(
  session: AuthenticatedAdminSessionMarker,
) {
  void session;
  return fetchAdmin<PermissionCatalog>("/platform/permissions/catalog", {});
}

export function listPlatformMembers(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<PlatformMember[]>("/platform/members", {});
}

export function createPlatformMember(
  session: AuthenticatedAdminSessionMarker,
  payload: PlatformMemberPayload,
) {
  return fetchAdmin<PlatformMember | PlatformMemberInvitation>(
    "/platform/members",
    {
      body: payload,
      method: "POST",
    },
  );
}

export function updatePlatformMember(
  session: AuthenticatedAdminSessionMarker,
  memberId: string,
  payload: PlatformMemberPayload,
) {
  return fetchAdmin<PlatformMember>(`/platform/members/${memberId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function deletePlatformMember(
  session: AuthenticatedAdminSessionMarker,
  memberId: string,
) {
  return fetchAdmin<void>(`/platform/members/${memberId}`, {
    method: "DELETE",
  });
}

export function listPlatformRoles(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Role[]>("/platform/roles", {});
}

export function createPlatformRole(
  session: AuthenticatedAdminSessionMarker,
  payload: RolePayload,
) {
  return fetchAdmin<Role>("/platform/roles", {
    body: payload,
    method: "POST",
  });
}

export function updatePlatformRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/platform/roles/${roleId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function replacePlatformRolePermissions(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  permissions: Array<{ enabled?: boolean; permission?: string }>,
) {
  return fetchAdmin<RolePermission[]>(`/platform/roles/${roleId}/permissions`, {
    body: { permissions },
    method: "PUT",
  });
}

export function deletePlatformRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
) {
  return fetchAdmin<void>(`/platform/roles/${roleId}`, {
    method: "DELETE",
  });
}
