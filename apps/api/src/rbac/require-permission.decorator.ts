import { SetMetadata } from "@nestjs/common";
import type {
  PermissionOperationMetadata,
  PermissionRequirement,
  PermissionResourceMetadata,
} from "./rbac.types.js";

export const REQUIRE_PERMISSION_METADATA = "hermes:require-permission";
export const PERMISSION_RESOURCE_METADATA = "hermes:permission-resource";

type LegacyPermissionRequirement = {
  action: string;
  entity: string;
  scope: PermissionResourceMetadata["scope"];
};

export function PermissionResource(resource: PermissionResourceMetadata) {
  return SetMetadata(PERMISSION_RESOURCE_METADATA, resource);
}

export function PermissionOperation(operation: PermissionOperationMetadata) {
  return SetMetadata(REQUIRE_PERMISSION_METADATA, operation);
}

export function RequirePermission(
  requirement: PermissionRequirement | LegacyPermissionRequirement,
) {
  if ("action" in requirement) {
    return PermissionOperation({
      entity: requirement.entity,
      entityLabel: requirement.entity,
      label: requirement.action,
      operation: requirement.action,
      purpose: requirement.entity,
      purposeLabel: requirement.entity,
      scope: requirement.scope,
    });
  }

  return PermissionOperation(requirement);
}
