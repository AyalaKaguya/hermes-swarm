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
import { WorkspaceContextService } from "./workspace-context.service.js";
import { WORKSPACE_DATABASE_GUCS } from "./workspace-database.constants.js";

export type ScopedRequest = {
  accessAudit?: {
    scope?: {
      scopeLevel?: RequestScopeLevel;
    };
  };
  accessPrincipal?: {
    principalType?: "integration" | "platform" | "workspace";
    workspaceId?: string | null;
  };
  headers?: Record<string, string | string[] | undefined>;
  originalUrl?: string;
  params?: Record<string, string | undefined>;
  url?: string;
};

@Injectable()
export class WorkspaceTransactionInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workspaceContext: WorkspaceContextService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<ScopedRequest>();
    const principal = request.accessPrincipal;
    if (!principal || principal.principalType === "platform") {
      return next.handle();
    }
    const workspaceId = normalizeValue(principal.workspaceId);
    if (!workspaceId) {
      throw new BadRequestException("登录会话缺少工作空间上下文");
    }
    const scope = resolveWorkspaceRequestScope(request);

    return defer(() =>
      from(
        this.dataSource.transaction(async (manager) => {
          await configureRlsContext(manager, workspaceId, scope);
          return this.workspaceContext.run(
            {
              manager,
              scopeLevel: scope.scopeLevel,
              workspaceId,
            },
            async () => {
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
  workspaceId: string,
  scope: {
    scopeLevel: RequestScopeLevel;
  },
) {
  await manager.query(
    `SELECT
      set_config('${WORKSPACE_DATABASE_GUCS.workspaceId}', $1, true),
      set_config('${WORKSPACE_DATABASE_GUCS.scopeLevel}', $2, true)`,
    [
      workspaceId,
      scope.scopeLevel,
    ],
  );
}

export function resolveWorkspaceRequestScope(request: ScopedRequest) {
  const authorizedScope = request.accessAudit?.scope;
  const authorizedScopeLevel = authorizedScope?.scopeLevel;
  if (authorizedScope && authorizedScopeLevel) {
    return normalizeAuthorizedScope({
      ...authorizedScope,
      scopeLevel: authorizedScopeLevel,
    });
  }

  return { scopeLevel: "workspace" as const };
}

function normalizeAuthorizedScope(scope: {
  scopeLevel: RequestScopeLevel;
}) {
  return { scopeLevel: scope.scopeLevel };
}

function normalizeValue(value: string | string[] | undefined | null) {
  const selected = Array.isArray(value) ? value[0] : value;
  return selected?.trim() || null;
}
