import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { parseAuthSessionToken } from "../auth/auth-session.js";
import {
  PERMISSION_RESOURCE_METADATA,
  REQUIRE_PERMISSION_METADATA,
} from "./require-permission.decorator.js";
import {
  RbacCatalogService,
  resolvePermissionDefinition,
} from "./rbac-catalog.service.js";
import { RbacService } from "./rbac.service.js";
import type {
  PermissionOperationMetadata,
  PermissionResourceMetadata,
} from "./rbac.types.js";

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly catalogService: RbacCatalogService,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const operation = this.reflector.getAllAndOverride<
      PermissionOperationMetadata | undefined
    >(REQUIRE_PERMISSION_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!operation) return true;

    const resource = this.reflector.get<
      PermissionResourceMetadata | undefined
    >(PERMISSION_RESOURCE_METADATA, context.getClass());
    const fallbackDefinition = resolvePermissionDefinition(resource, operation);
    if (!fallbackDefinition) return true;

    const definition =
      this.catalogService.getDefinition(fallbackDefinition.id) ??
      fallbackDefinition;

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      params?: Record<string, string | undefined>;
    }>();
    const token = this.extractBearerToken(request.headers?.authorization);
    const session = parseAuthSessionToken(token);
    if (!session) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const allowed = await this.rbacService.can(
      session.userId,
      definition,
      definition.scope === "own"
        ? request.params?.userId
        : request.params?.organizationId,
    );
    if (!allowed) {
      throw new ForbiddenException({
        code: this.catalogService.getDefinition(definition.id)
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

    return true;
  }

  private extractBearerToken(value: string | string[] | undefined) {
    const header = Array.isArray(value) ? value[0] : value;
    if (!header) return undefined;
    return header.replace(/^Bearer\s+/i, "").trim();
  }
}
