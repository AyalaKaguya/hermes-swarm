import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { parseAuthSessionToken } from "../auth/auth-session.js";
import { FeatureAccessService } from "./feature-access.service.js";
import { REQUIRE_FEATURE_METADATA } from "./require-feature.decorator.js";

@Injectable()
export class FeatureAccessGuard implements CanActivate {
  constructor(
    private readonly featureAccessService: FeatureAccessService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext) {
    const featureKey = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_FEATURE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!featureKey) return true;

    const request = context.switchToHttp().getRequest<{
      headers?: Record<string, string | string[] | undefined>;
      params?: Record<string, string | undefined>;
    }>();
    const organizationId = request.params?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException("缺少组织上下文");
    }

    const session = parseAuthSessionToken(
      extractBearerToken(request.headers?.authorization),
    );
    if (!session) {
      throw new UnauthorizedException("登录已失效，请重新登录");
    }

    const allowed =
      await this.featureAccessService.isFeatureEnabledForUser(
        organizationId,
        featureKey,
        session.userId,
      );
    if (!allowed) {
      throw new ForbiddenException("功能未启用或当前用户不在访问范围内");
    }
    return true;
  }
}

function extractBearerToken(value: string | string[] | undefined) {
  const header = Array.isArray(value) ? value[0] : value;
  if (!header) return undefined;
  return header.replace(/^Bearer\s+/i, "").trim();
}
