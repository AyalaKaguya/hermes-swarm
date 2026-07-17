import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { Organization, Tenant } from "@hermes-swarm/core";
import { DataSource, IsNull, type EntityManager } from "typeorm";
import { defer, from, lastValueFrom, type Observable } from "rxjs";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";
import { TenantContextService } from "./tenant-context.service.js";
import { TENANT_DATABASE_GUCS } from "./tenant-database.constants.js";

export type ScopedRequest = {
  accessAudit?: {
    scope?: {
      organizationId?: string | null;
      scopeLevel?: RequestScopeLevel;
    };
  };
  accessPrincipal?: {
    principalType?: "integration" | "platform" | "tenant";
    tenantId?: string | null;
  };
  headers?: Record<string, string | string[] | undefined>;
  originalUrl?: string;
  params?: Record<string, string | undefined>;
  url?: string;
};

@Injectable()
export class TenantTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly tenantContext: TenantContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const principal = request.accessPrincipal;
    if (!principal || principal.principalType === "platform") {
      return next.handle();
    }
    const tenantId = normalizeValue(principal.tenantId);
    if (!tenantId) {
      throw new BadRequestException("登录会话缺少租户上下文");
    }
    const scope = resolveTenantRequestScope(request);

    return defer(() =>
      from(
        this.dataSource.transaction(async (manager) => {
          await configureRlsContext(manager, tenantId, scope);
          return this.tenantContext.run(
            {
              manager,
              organizationId: scope.organizationId,
              scopeLevel: scope.scopeLevel,
              tenantId,
            },
            async () => {
              await assertTenantOnboardingAccess(manager, tenantId, request);
              return lastValueFrom(next.handle());
            },
          );
        }),
      ),
    );
  }
}

export async function configureRlsContext(
  manager: EntityManager,
  tenantId: string,
  scope: {
    organizationId: string | null;
    scopeLevel: RequestScopeLevel;
  },
) {
  await manager.query(
    `SELECT
      set_config('${TENANT_DATABASE_GUCS.tenantId}', $1, true),
      set_config('${TENANT_DATABASE_GUCS.scopeLevel}', $2, true),
      set_config('${TENANT_DATABASE_GUCS.organizationId}', $3, true)`,
    [
      tenantId,
      scope.scopeLevel,
      scope.organizationId ?? "",
    ],
  );
}

export function resolveTenantRequestScope(request: ScopedRequest) {
  const authorizedScope = request.accessAudit?.scope;
  const authorizedScopeLevel = authorizedScope?.scopeLevel;
  if (authorizedScope && authorizedScopeLevel) {
    return normalizeAuthorizedScope({
      ...authorizedScope,
      scopeLevel: authorizedScopeLevel,
    });
  }

  const pathOrganizationId = normalizeValue(request.params?.organizationId);
  return pathOrganizationId
    ? { organizationId: pathOrganizationId, scopeLevel: "organization" as const }
    : { organizationId: null, scopeLevel: "tenant" as const };
}

function normalizeAuthorizedScope(scope: {
  organizationId?: string | null;
  scopeLevel: RequestScopeLevel;
}) {
  if (scope.scopeLevel === "tenant") {
    return {
      organizationId: null,
      scopeLevel: scope.scopeLevel,
    };
  }

  const organizationId = normalizeValue(scope.organizationId);
  if (!organizationId) throw new BadRequestException("请求缺少 Organization-Id");
  if (scope.scopeLevel === "organization") {
    return {
      organizationId,
      scopeLevel: scope.scopeLevel,
    };
  }

  throw new BadRequestException("请求作用域无效");
}

async function assertTenantOnboardingAccess(
  manager: EntityManager,
  tenantId: string,
  request: ScopedRequest,
) {
  const tenant = await manager.findOne(Tenant, { where: { id: tenantId } });
  if (!tenant || tenant.status !== "provisioning") return;
  const rootExists = await manager.exists(Organization, {
    where: { parentOrganizationId: IsNull(), tenantId },
  });
  if (rootExists) return;
  const url = request.originalUrl ?? request.url ?? "";
  if (
    /\/admin\/auth\/me(?:[/?]|$)/.test(url) ||
    /\/admin\/tenant\/onboarding\/root-organization(?:[/?]|$)/.test(url)
  ) {
    return;
  }
  throw new ForbiddenException("请先创建根组织完成工作空间初始化");
}

function normalizeValue(value: string | string[] | undefined | null) {
  const selected = Array.isArray(value) ? value[0] : value;
  return selected?.trim() || null;
}
