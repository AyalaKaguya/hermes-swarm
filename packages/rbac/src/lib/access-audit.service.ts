import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  AccessAuditLog,
  type AccessAuditResult,
} from "@hermes-swarm/core";
import type { Repository } from "typeorm";
import type { AccessRequest } from "./access.types.js";
import { resolveClientIp } from "./client-ip.js";

@Injectable()
export class AccessAuditService {
  private readonly logger = new Logger(AccessAuditService.name);

  constructor(
    @InjectRepository(AccessAuditLog)
    private readonly repository: Repository<AccessAuditLog>,
  ) {}

  /** Audit persistence is fail-open so an audit outage never changes authorization. */
  async recordRequest(
    request: AccessRequest,
    result: AccessAuditResult,
    input: {
      error?: unknown;
      statusCode?: number | null;
      targetWorkspaceId?: string | null;
    } = {},
  ) {
    const context = request.accessAudit;
    if (!context) return;
    const principal = request.accessPrincipal;
    const path = normalizeText(
      request.originalUrl ?? request.url,
      500,
    );
    try {
      await this.repository.insert({
        actorId: principal?.userId ?? null,
        errorCode: resolveErrorCode(input.error),
        httpMethod: normalizeText(request.method, 16)?.toUpperCase() ?? null,
        httpPath: path,
        ipAddress: normalizeText(resolveClientIp(request), 64),
        permission: context.definition.id,
        principalType: principal?.principalType ?? "anonymous",
        result,
        scopeType: context.definition.scope,
        sessionId: normalizeUuid(principal?.sessionId),
        statusCode: input.statusCode ?? resolveStatusCode(input.error),
        targetWorkspaceId:
          normalizeText(input.targetWorkspaceId, 80) ?? resolveTargetWorkspaceId(request),
        workspaceId:
          principal?.principalType === "platform"
            ? null
            : principal?.workspaceId ?? context.scope.workspaceId ?? null,
        userAgent: normalizeText(readHeader(request, "user-agent"), 500),
      });
    } catch (error) {
      this.logger.error(`Failed to persist access audit: ${String(error)}`);
    }
  }
}

function resolveTargetWorkspaceId(request: AccessRequest) {
  if (request.accessPrincipal?.principalType !== "platform") return null;
  return (
    normalizeText(request.params?.workspaceId, 80) ??
    normalizeText(readHeader(request, "target-workspace-id"), 80)
  );
}

function readHeader(request: AccessRequest, name: string) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value, 36);
  return normalized && /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}

function resolveStatusCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "getStatus" in error &&
    typeof error.getStatus === "function"
  ) {
    return error.getStatus();
  }
  return null;
}

function resolveErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const candidate = error as {
    code?: unknown;
    getResponse?: () => unknown;
    name?: unknown;
  };
  const response =
    typeof candidate.getResponse === "function"
      ? candidate.getResponse()
      : undefined;
  const responseCode =
    response && typeof response === "object" && "code" in response
      ? (response as { code?: unknown }).code
      : undefined;
  return normalizeText(responseCode ?? candidate.code ?? candidate.name, 120);
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}
