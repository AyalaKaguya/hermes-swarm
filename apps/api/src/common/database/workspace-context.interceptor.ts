import {
  BadRequestException,
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { defer, from, lastValueFrom, type Observable } from "rxjs";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";
import { WorkspaceContextService } from "./workspace-context.service.js";

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

/**
 * Carries an already-authorized workspace scope through asynchronous request
 * handling. Database access remains explicit in each service; this interceptor
 * deliberately neither starts a transaction nor mutates PostgreSQL session
 * state.
 */
@Injectable()
export class WorkspaceContextInterceptor implements NestInterceptor {
  constructor(private readonly workspaceContext: WorkspaceContextService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = _context.switchToHttp().getRequest<ScopedRequest>();
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
        this.workspaceContext.run(
          { scopeLevel: scope.scopeLevel, workspaceId },
          () => lastValueFrom(next.handle()),
        ),
      ),
    );
  }
}

export function resolveWorkspaceRequestScope(request: ScopedRequest) {
  const authorizedScopeLevel = request.accessAudit?.scope?.scopeLevel;
  return { scopeLevel: authorizedScopeLevel ?? ("workspace" as const) };
}

function normalizeValue(value: string | string[] | undefined | null) {
  const selected = Array.isArray(value) ? value[0] : value;
  return selected?.trim() || null;
}
