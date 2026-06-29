import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { parseAuthSessionToken } from "../tenancy/admin-session.js";
import {
  REQUIRE_PERMISSION_METADATA,
} from "./require-permission.decorator.js";
import { RbacService } from "./rbac.service.js";
import type { PermissionRequirement } from "./rbac.types.js";

@Injectable()
export class RbacGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly rbacService: RbacService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const requirement = this.reflector.getAllAndOverride<
      PermissionRequirement | undefined
    >(REQUIRE_PERMISSION_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!requirement) return true;

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
      requirement,
      request.params?.organizationId,
    );
    if (!allowed) {
      throw new ForbiddenException("没有执行该操作的权限");
    }

    return true;
  }

  private extractBearerToken(value: string | string[] | undefined) {
    const header = Array.isArray(value) ? value[0] : value;
    if (!header) return undefined;
    return header.replace(/^Bearer\s+/i, "").trim();
  }
}
