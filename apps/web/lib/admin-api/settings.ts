import type { AuthenticatedAdminSessionMarker } from "@/lib/authenticated-admin";
import type {
  EffectiveWorkspaceSetting,
  PermissionCatalog,
  Role,
  RolePayload,
  SaveSettingsPayload,
  SystemSettingDto,
  Workspace,
} from "@hermes-swarm/api-contracts";
import { fetchAdmin } from "./client";

export function listSystemSettings(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<SystemSettingDto[]>("/platform/settings", {});
}

export function saveSystemSettings(
  session: AuthenticatedAdminSessionMarker,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<SystemSettingDto[]>("/platform/settings", {
    body: settings,
    method: "PUT",
  });
}

export function listWorkspaceSettings(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<EffectiveWorkspaceSetting[]>("/workspace/settings", {});
}

export function saveWorkspaceSettings(
  session: AuthenticatedAdminSessionMarker,
  settings: SaveSettingsPayload,
) {
  return fetchAdmin<EffectiveWorkspaceSetting[]>("/workspace/settings", {
    body: settings,
    method: "PUT",
  });
}

export function updateWorkspace(
  session: AuthenticatedAdminSessionMarker,
  payload: Partial<Pick<Workspace, "name">>,
) {
  return fetchAdmin<Workspace>("/workspace", {
    body: payload,
    method: "PATCH",
  });
}

export function listWorkspaceRoles(session: AuthenticatedAdminSessionMarker) {
  return fetchAdmin<Role[]>("/workspace/roles", {});
}

export function createWorkspaceRole(
  session: AuthenticatedAdminSessionMarker,
  payload: RolePayload,
) {
  return fetchAdmin<Role>("/workspace/roles", {
    body: payload,
    method: "POST",
  });
}

export function updateWorkspaceRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  payload: RolePayload,
) {
  return fetchAdmin<Role>(`/workspace/roles/${roleId}`, {
    body: payload,
    method: "PATCH",
  });
}

export function replaceWorkspaceRolePermissions(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
  permissions: Array<{ enabled?: boolean; permission?: string }>,
) {
  return fetchAdmin<Role>(`/workspace/roles/${roleId}/permissions`, {
    body: { permissions },
    method: "PUT",
  });
}

export function deleteWorkspaceRole(
  session: AuthenticatedAdminSessionMarker,
  roleId: string,
) {
  return fetchAdmin<{ success: boolean }>(`/workspace/roles/${roleId}`, {
    method: "DELETE",
  });
}

export function listPermissionCatalog(session: AuthenticatedAdminSessionMarker) {
  void session;
  return fetchAdmin<PermissionCatalog>("/workspace/permissions/catalog", {});
}
