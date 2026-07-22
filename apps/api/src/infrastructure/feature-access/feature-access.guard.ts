import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { FeatureAccessService } from "./feature-access.service.js";
import { REQUIRE_FEATURE_METADATA } from "./require-feature.decorator.js";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import {
  resolveWorkspaceRequestScope,
  type ScopedRequest,
} from "../../common/database/workspace-context.interceptor.js";

@Injectable()
export class FeatureAccessGuard implements CanActivate {
  constructor(
    private readonly featureAccessService: FeatureAccessService,
    private readonly reflector: Reflector,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const featureKey = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_FEATURE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!featureKey) return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const workspaceId = request.accessPrincipal?.workspaceId?.trim() || undefined;
    const checkFeature = () =>
      this.featureAccessService.isFeatureEnabled(featureKey, {
        workspaceId,
      });
    const currentContext = this.workspaceContext.current(false);
    const allowed =
      !workspaceId || currentContext
        ? await checkFeature()
        : await this.workspaceContext.run(
            {
              scopeLevel: resolveWorkspaceRequestScope(request).scopeLevel,
              workspaceId,
            },
            checkFeature,
          );
    if (!allowed) {
      throw new ForbiddenException("功能未启用");
    }
    return true;
  }
}
