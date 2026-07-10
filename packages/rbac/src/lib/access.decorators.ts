import { createParamDecorator, ExecutionContext, SetMetadata } from "@nestjs/common";
import type {
  AccessOperationMetadata,
  AccessRequirement,
  AccessResourceMetadata,
  AccessScopeMetadata,
} from "./access.types.js";

export const ACCESS_OPERATION_METADATA = "hermes:access-operation";
export const ACCESS_RESOURCE_METADATA = "hermes:access-resource";
export const ACCESS_SCOPE_METADATA = "hermes:access-scope";
export const PUBLIC_ACCESS_METADATA = "hermes:public-access";

export const REQUIRE_PERMISSION_METADATA = "hermes:require-permission";
export const PERMISSION_RESOURCE_METADATA = "hermes:permission-resource";

type LegacyPermissionRequirement = {
  action: string;
  entity: string;
  scope: AccessResourceMetadata["scope"];
};

export function AccessResource(resource: AccessResourceMetadata) {
  return SetMetadata(ACCESS_RESOURCE_METADATA, resource);
}

export function AccessOperation(operation: AccessOperationMetadata) {
  return SetMetadata(ACCESS_OPERATION_METADATA, operation);
}

export function AccessScope(scope: AccessScopeMetadata) {
  return SetMetadata(ACCESS_SCOPE_METADATA, scope);
}

/** Marks an intentionally unauthenticated endpoint. */
export function PublicAccess(input: { reason: string }) {
  return SetMetadata(PUBLIC_ACCESS_METADATA, input);
}

/** Returns the principal validated by the global AccessGuard. */
export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext) =>
    context.switchToHttp().getRequest<{ accessPrincipal?: unknown }>()
      .accessPrincipal,
);

export function PermissionResource(resource: AccessResourceMetadata) {
  return SetMetadata(PERMISSION_RESOURCE_METADATA, resource);
}

export function PermissionOperation(operation: AccessOperationMetadata) {
  return SetMetadata(REQUIRE_PERMISSION_METADATA, operation);
}

export function RequirePermission(
  requirement: AccessRequirement | LegacyPermissionRequirement,
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

