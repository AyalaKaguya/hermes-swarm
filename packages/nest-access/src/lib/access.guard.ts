import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ACCESS_OPERATION_METADATA,
  ACCESS_RESOURCE_METADATA,
  ACCESS_SCOPE_METADATA,
  PERMISSION_RESOURCE_METADATA,
  REQUIRE_PERMISSION_METADATA,
} from "./access.decorators.js";
import { AccessCatalogService, resolveAccessDefinition } from "./access-catalog.service.js";
import { createAccessDeniedException } from "./access-denied.js";
import { AccessScopeService } from "./access-scope.service.js";
import { AccessService } from "./access-service.js";
import type {
  AccessAuthSessionService,
  AccessOperationMetadata,
  AccessResourceMetadata,
  AccessScopeMetadata,
} from "./access.types.js";
import { ACCESS_AUTH_SESSION_SERVICE } from "./tokens.js";

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(ACCESS_AUTH_SESSION_SERVICE)
    private readonly authSessionService: AccessAuthSessionService,
    private readonly catalogService: AccessCatalogService,
    private readonly accessService: AccessService,
    private readonly scopeService: AccessScopeService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const operation = this.getOperationMetadata(context);
    if (!operation) return true;

    const resource = this.getResourceMetadata(context);
    const fallbackDefinition = resolveAccessDefinition(resource, operation);
    if (!fallbackDefinition) return true;

    const definition =
      this.catalogService.getDefinition(fallbackDefinition.id) ??
      fallbackDefinition;
    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      params?: Record<string, string | undefined>;
      [key: string]: unknown;
    }>();

    let session: Awaited<
      ReturnType<AccessAuthSessionService["validateAccessToken"]>
    >;
    try {
      session = await this.authSessionService.validateAccessToken(
        this.extractBearerToken(request.headers?.authorization),
      );
    } catch {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const scopeContext = await this.scopeService.resolve(
      definition,
      this.getScopeMetadata(context),
      request,
    );
    const allowed = await this.accessService.can(
      session.userId,
      definition,
      scopeContext,
    );
    if (!allowed) {
      throw createAccessDeniedException(
        definition,
        Boolean(this.catalogService.getDefinition(definition.id)),
      );
    }

    return true;
  }

  private getOperationMetadata(context: ExecutionContext) {
    return (
      this.reflector.getAllAndOverride<AccessOperationMetadata | undefined>(
        ACCESS_OPERATION_METADATA,
        [context.getHandler(), context.getClass()],
      ) ??
      this.reflector.getAllAndOverride<AccessOperationMetadata | undefined>(
        REQUIRE_PERMISSION_METADATA,
        [context.getHandler(), context.getClass()],
      )
    );
  }

  private getResourceMetadata(context: ExecutionContext) {
    return (
      this.reflector.get<AccessResourceMetadata | undefined>(
        ACCESS_RESOURCE_METADATA,
        context.getClass(),
      ) ??
      this.reflector.get<AccessResourceMetadata | undefined>(
        PERMISSION_RESOURCE_METADATA,
        context.getClass(),
      )
    );
  }

  private getScopeMetadata(context: ExecutionContext) {
    return this.reflector.getAllAndOverride<AccessScopeMetadata | undefined>(
      ACCESS_SCOPE_METADATA,
      [context.getHandler(), context.getClass()],
    );
  }

  private extractBearerToken(value: string | string[] | undefined) {
    const header = Array.isArray(value) ? value[0] : value;
    if (!header) return undefined;
    return header.replace(/^Bearer\s+/i, "").trim();
  }
}
