import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
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
      params?: Record<string, string | undefined>;
    }>();
    const organizationId = request.params?.organizationId;
    if (!organizationId) {
      throw new ForbiddenException("缺少组织上下文");
    }

    const allowed = await this.featureAccessService.isFeatureEnabled(
      organizationId,
      featureKey,
    );
    if (!allowed) {
      throw new ForbiddenException("功能未启用");
    }
    return true;
  }
}
