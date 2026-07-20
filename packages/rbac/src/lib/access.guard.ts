import {
  CanActivate,
  ForbiddenException,
  ExecutionContext,
  Inject,
  Injectable,
  Optional,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  ACCESS_OPERATION_METADATA,
  ACCESS_RESOURCE_METADATA,
  ACCESS_SCOPE_METADATA,
  PUBLIC_ACCESS_METADATA,
  PERMISSION_RESOURCE_METADATA,
  REQUIRE_PERMISSION_METADATA,
} from "./access.decorators.js";
import { AccessCatalogService, resolveAccessDefinition } from "./access-catalog.service.js";
import { AccessAuditService } from "./access-audit.service.js";
import { createAccessDeniedException } from "./access-denied.js";
import { AccessScopeService } from "./access-scope.service.js";
import { AccessService } from "./access-service.js";
import type {
  AccessAuthSessionService,
  AccessOperationMetadata,
  AccessRequest,
  AccessResourceMetadata,
  AccessScopeMetadata,
  ResolvedAccessDefinition,
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
    @Optional()
    private readonly auditService?: AccessAuditService,
  ) {}

  async canActivate(context: ExecutionContext) {
    if (this.isPublic(context)) return true;

    const operation = this.getOperationMetadata(context);
    if (!operation) {
      if (this.isAdminRequest(context)) {
        throw accessMetadataError(
          "ACCESS_METADATA_MISSING",
          "受保护接口缺少 Access 元数据",
        );
      }
      return true;
    }

    const resource = this.getResourceMetadata(context);
    const fallbackDefinition = resolveAccessDefinition(resource, operation);
    if (!fallbackDefinition) {
      throw accessMetadataError(
        "ACCESS_METADATA_INVALID",
        "Access 元数据无法解析为完整权限定义",
      );
    }

    const definition = this.catalogService.getDefinition(fallbackDefinition.id);
    if (!definition) {
      throw accessMetadataError(
        "ACCESS_DEFINITION_UNKNOWN",
        "Access 定义不在已同步权限目录中",
      );
    }
    const request = context.switchToHttp().getRequest<AccessRequest>();

    let session: Awaited<
      ReturnType<AccessAuthSessionService["validateAccessToken"]>
    >;
    try {
      session = await this.authSessionService.validateAccessToken(
        this.extractBearerToken(request.headers?.authorization),
      );
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    request.accessPrincipal = session;
    request.accessAudit = { definition, scope: { tenantId: session.tenantId } };
    let scopeContext;
    try {
      scopeContext = await this.scopeService.resolve(
        definition,
        this.getScopeMetadata(context),
        request,
      );
      request.accessAudit.scope = scopeContext;
    } catch (error) {
      await this.auditService?.recordRequest(request, "error", { error });
      throw error;
    }
    const accessContext = {
      ...scopeContext,
      principalType: session.principalType,
      tenantId: session.tenantId,
    };
    const tokenAllowed = integrationTokenAllows(
      session,
      definition,
      accessContext,
    );
    let allowed = false;
    try {
      if (tokenAllowed) {
        allowed = await this.accessService.can(
          session.userId,
          definition,
          accessContext,
        );
      }
    } catch (error) {
      await this.auditService?.recordRequest(request, "error", { error });
      throw error;
    }
    if (!tokenAllowed || !allowed) {
      const error = createAccessDeniedException(
        definition,
        Boolean(this.catalogService.getDefinition(definition.id)),
      );
      await this.auditService?.recordRequest(request, "denied", { error });
      throw error;
    }

    return true;
  }

  private isAdminRequest(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<{
      originalUrl?: string;
      url?: string;
    }>();
    const path = request.originalUrl ?? request.url ?? "";
    return (
      /(?:^|\/)api\/admin(?:\/|$)/.test(path) ||
      /(?:^|\/)admin(?:\/|$)/.test(path)
    );
  }

  private isPublic(context: ExecutionContext) {
    return Boolean(
      this.reflector.getAllAndOverride<{ reason: string } | undefined>(
        PUBLIC_ACCESS_METADATA,
        [context.getHandler(), context.getClass()],
      ),
    );
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
      this.reflector.getAllAndOverride<AccessResourceMetadata | undefined>(
        ACCESS_RESOURCE_METADATA,
        [context.getHandler(), context.getClass()],
      ) ??
      this.reflector.getAllAndOverride<AccessResourceMetadata | undefined>(
        PERMISSION_RESOURCE_METADATA,
        [context.getHandler(), context.getClass()],
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

function accessMetadataError(code: string, message: string) {
  return new ForbiddenException({ code, message, statusCode: 403 });
}

function integrationTokenAllows(
  session: Awaited<ReturnType<AccessAuthSessionService["validateAccessToken"]>>,
  definition: ResolvedAccessDefinition,
  scopeContext: {
    organizationId?: string | null;
    targetUserId?: string | null;
    tenantId?: string | null;
  },
) {
  const token = session.integrationToken;
  if (!token) return true;
  if (token.tenantId !== (scopeContext.tenantId ?? null)) return false;
  if (definition.scope === "platform") return false;
  if (!token.permissions.includes(definition.id)) return false;
  return true;
}
