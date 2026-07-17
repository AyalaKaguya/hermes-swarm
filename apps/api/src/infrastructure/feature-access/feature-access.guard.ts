import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { DataSource } from "typeorm";
import { FeatureAccessService } from "./feature-access.service.js";
import { REQUIRE_FEATURE_METADATA } from "./require-feature.decorator.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";
import {
  configureRlsContext,
  resolveTenantRequestScope,
  type ScopedRequest,
} from "../../common/database/tenant-transaction.interceptor.js";

@Injectable()
export class FeatureAccessGuard implements CanActivate {
  constructor(
    private readonly featureAccessService: FeatureAccessService,
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const featureKey = this.reflector.getAllAndOverride<string | undefined>(
      REQUIRE_FEATURE_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!featureKey) return true;

    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const tenantId = request.accessPrincipal?.tenantId?.trim() || undefined;
    const checkFeature = () =>
      this.featureAccessService.isFeatureEnabled(featureKey, {
        tenantId,
      });
    const currentContext = this.tenantContext.current(false);
    const allowed =
      !tenantId || currentContext
        ? await checkFeature()
        : await this.dataSource.transaction(async (manager) => {
            const scope = resolveTenantRequestScope(request);
            await configureRlsContext(manager, tenantId, scope);
            return this.tenantContext.run(
              {
                manager,
                organizationId: scope.organizationId,
                scopeLevel: scope.scopeLevel,
                tenantId,
              },
              checkFeature,
            );
          });
    if (!allowed) {
      throw new ForbiddenException("功能未启用");
    }
    return true;
  }
}
