import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { DataSource, type EntityManager } from "typeorm";
import { defer, from, lastValueFrom, type Observable } from "rxjs";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";
import { TenantContextService } from "./tenant-context.service.js";
import { TENANT_DATABASE_GUCS } from "./tenant-database.constants.js";

export type ScopedRequest = {
  accessPrincipal?: {
    principalType?: "integration" | "platform" | "tenant";
    tenantId?: string | null;
  };
  headers?: Record<string, string | string[] | undefined>;
  params?: Record<string, string | undefined>;
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
              departmentId: scope.departmentId,
              manager,
              organizationId: scope.organizationId,
              scopeLevel: scope.scopeLevel,
              tenantId,
            },
            () => lastValueFrom(next.handle()),
          );
        }),
      ),
    );
  }
}

async function configureRlsContext(
  manager: EntityManager,
  tenantId: string,
  scope: {
    departmentId: string | null;
    organizationId: string | null;
    scopeLevel: RequestScopeLevel;
  },
) {
  await manager.query(
    `SELECT
      set_config('${TENANT_DATABASE_GUCS.tenantId}', $1, true),
      set_config('${TENANT_DATABASE_GUCS.scopeLevel}', $2, true),
      set_config('${TENANT_DATABASE_GUCS.organizationId}', $3, true),
      set_config('${TENANT_DATABASE_GUCS.departmentId}', $4, true)`,
    [
      tenantId,
      scope.scopeLevel,
      scope.organizationId ?? "",
      scope.departmentId ?? "",
    ],
  );
}

export function resolveTenantRequestScope(request: ScopedRequest) {
  const scopeLevel = normalizeScope(getHeader(request, "x-scope-level"));
  const pathOrganizationId = normalizeValue(request.params?.organizationId);
  const pathDepartmentId = normalizeValue(request.params?.departmentId);
  const headerOrganizationId = normalizeValue(getHeader(request, "organization-id"));
  const headerDepartmentId = normalizeValue(getHeader(request, "department-id"));

  if (
    pathOrganizationId &&
    headerOrganizationId &&
    pathOrganizationId !== headerOrganizationId
  ) {
    throw new BadRequestException("organizationId 与请求头作用域不一致");
  }
  if (
    pathDepartmentId &&
    headerDepartmentId &&
    pathDepartmentId !== headerDepartmentId
  ) {
    throw new BadRequestException("departmentId 与请求头作用域不一致");
  }
  const organizationId = pathOrganizationId ?? headerOrganizationId;
  const departmentId = pathDepartmentId ?? headerDepartmentId;

  if (scopeLevel === "tenant") {
    if (organizationId || departmentId) {
      throw new BadRequestException("租户作用域不能携带组织或部门");
    }
    return { departmentId: null, organizationId: null, scopeLevel };
  }
  if (!organizationId) throw new BadRequestException("请求缺少 Organization-Id");
  if (scopeLevel === "organization") {
    if (departmentId) throw new BadRequestException("组织作用域不能携带 Department-Id");
    return { departmentId: null, organizationId, scopeLevel };
  }
  if (!departmentId) throw new BadRequestException("请求缺少 Department-Id");
  return { departmentId, organizationId, scopeLevel };
}

function normalizeScope(value: string | string[] | undefined): RequestScopeLevel {
  const normalized = normalizeValue(value);
  if (!normalized || normalized === "tenant") return "tenant";
  if (normalized === "organization" || normalized === "department") return normalized;
  throw new BadRequestException("请求作用域无效");
}

function getHeader(request: ScopedRequest, name: string) {
  return request.headers?.[name] ?? request.headers?.[toTitleCase(name)];
}

function toTitleCase(name: string) {
  return name
    .split("-")
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join("-");
}

function normalizeValue(value: string | string[] | undefined | null) {
  const selected = Array.isArray(value) ? value[0] : value;
  return selected?.trim() || null;
}
