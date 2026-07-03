import { ForbiddenException } from "@nestjs/common";
import type { ResolvedAccessDefinition } from "./access.types.js";

export function createAccessDeniedException(
  definition: ResolvedAccessDefinition,
  registered: boolean,
) {
  return new ForbiddenException({
    code: registered
      ? "RBAC_PERMISSION_DENIED"
      : "RBAC_PERMISSION_NOT_REGISTERED",
    message: `没有权限：${definition.operationLabel}`,
    permission: {
      description: definition.description,
      entity: definition.entity,
      entityLabel: definition.entityLabel,
      id: definition.id,
      label: definition.operationLabel,
      operation: definition.operation,
      operationLabel: definition.operationLabel,
      purpose: definition.purpose,
      purposeLabel: definition.purposeLabel,
      scope: definition.scope,
    },
    statusCode: 403,
  });
}

