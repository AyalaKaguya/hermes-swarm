import type { PermissionScope } from "./types.js";

export function getOperationPermissionId(
  entity: string,
  purpose: string,
  operation: string,
  scope: PermissionScope,
) {
  return `${entity}.${purpose}.${operation}:${scope}`;
}

export function getPageAccessPermissionId(
  pageKey: string,
  scope: PermissionScope,
) {
  return `page.${pageKey}.access:${scope}`;
}

