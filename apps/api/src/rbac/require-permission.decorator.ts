import { SetMetadata } from "@nestjs/common";
import type { PermissionRequirement } from "./rbac.types.js";

export const REQUIRE_PERMISSION_METADATA = "hermes:require-permission";

export function RequirePermission(requirement: PermissionRequirement) {
  return SetMetadata(REQUIRE_PERMISSION_METADATA, requirement);
}
