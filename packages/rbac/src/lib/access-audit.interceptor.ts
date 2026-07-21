import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from "@nestjs/common";
import { catchError, concatMap, from, map, of, throwError } from "rxjs";
import { AccessAuditService } from "./access-audit.service.js";
import type { AccessRequest } from "./access.types.js";

@Injectable()
export class AccessAuditInterceptor implements NestInterceptor {
  constructor(private readonly auditService: AccessAuditService) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): ReturnType<CallHandler["handle"]> {
    const http = context.switchToHttp();
    const request = http.getRequest<AccessRequest>();
    if (!request.accessAudit) return next.handle();
    const response = http.getResponse<{ statusCode?: number }>();
    let recorded = false;
    return next.handle().pipe(
      concatMap((value: unknown) => {
        if (recorded) return of(value);
        recorded = true;
        return from(
          this.auditService.recordRequest(request, "allowed", {
            statusCode: response.statusCode ?? 200,
            targetWorkspaceId: extractTargetWorkspaceId(value),
          }),
        ).pipe(map(() => value));
      }),
      catchError((error: unknown) =>
        from(
          this.auditService.recordRequest(request, "error", { error }),
        ).pipe(concatMap(() => throwError(() => error))),
      ),
    );
  }
}

function extractTargetWorkspaceId(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const record = value as {
    targetWorkspaceId?: unknown;
    workspace?: { id?: unknown } | null;
    workspaceId?: unknown;
  };
  const candidate = record.targetWorkspaceId ?? record.workspaceId ?? record.workspace?.id;
  return typeof candidate === "string" && candidate.trim()
    ? candidate.trim()
    : null;
}
