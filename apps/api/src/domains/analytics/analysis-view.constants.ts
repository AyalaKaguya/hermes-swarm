import { getOperationPermissionId } from "@hermes-swarm/rbac-api";

function viewPermission(operation: string) {
  return getOperationPermissionId(
    "analytics",
    "saved_view",
    operation,
    "workspace",
  );
}

export const ANALYSIS_VIEW_LIST_PERMISSION = viewPermission("list");
export const ANALYSIS_VIEW_READ_PERMISSION = viewPermission("read");
export const ANALYSIS_VIEW_CREATE_PERMISSION = viewPermission("create");
export const ANALYSIS_VIEW_UPDATE_PERMISSION = viewPermission("update");
export const ANALYSIS_VIEW_DELETE_PERMISSION = viewPermission("delete");
