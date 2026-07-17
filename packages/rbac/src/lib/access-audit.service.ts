import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  AccessAuditLog,
  type AccessAuditResult,
} from "@hermes-swarm/core";
import type { Repository } from "typeorm";
import type { AccessRequest } from "./access.types.js";
import { PLATFORM_DATA_SOURCE } from "./tokens.js";

@Injectable()
export class AccessAuditService {
  private readonly logger = new Logger(AccessAuditService.name);

  constructor(
    @InjectRepository(AccessAuditLog, PLATFORM_DATA_SOURCE)
    private readonly repository: Repository<AccessAuditLog>,
  ) {}

  /** Audit persistence is fail-open so an audit outage never changes authorization. */
  async recordRequest(
    request: AccessRequest,
    result: AccessAuditResult,
    input: {
      error?: unknown;
      statusCode?: number | null;
      targetTenantId?: string | null;
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
        ipAddress: normalizeText(resolveRequestIp(request), 64),
        organizationId: context.scope.organizationId ?? null,
        permission: context.definition.id,
        principalType: principal?.principalType ?? "anonymous",
        result,
        scopeType: context.definition.scope,
        sessionId: normalizeUuid(principal?.sessionId),
        statusCode: input.statusCode ?? resolveStatusCode(input.error),
        targetTenantId:
          normalizeText(input.targetTenantId, 80) ?? resolveTargetTenantId(request),
        tenantId:
          principal?.principalType === "platform"
            ? null
            : principal?.tenantId ?? context.scope.tenantId ?? null,
        userAgent: normalizeText(readHeader(request, "user-agent"), 500),
      });
    } catch (error) {
      this.logger.error(`Failed to persist access audit: ${String(error)}`);
    }
  }
}

function resolveTargetTenantId(request: AccessRequest) {
  if (request.accessPrincipal?.principalType !== "platform") return null;
  return (
    normalizeText(request.params?.tenantId, 80) ??
    normalizeText(readHeader(request, "target-tenant-id"), 80)
  );
}

function readHeader(request: AccessRequest, name: string) {
  const value = request.headers?.[name] ?? request.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function resolveRequestIp(request: AccessRequest) {
  const forwardedFor = readHeader(request, "x-forwarded-for");
  if (typeof forwardedFor === "string" && forwardedFor.trim()) {
    return forwardedFor.split(",")[0]?.trim() ?? null;
  }
  const candidate = request as AccessRequest & {
    ip?: unknown;
    socket?: { remoteAddress?: unknown };
  };
  return candidate.ip ?? candidate.socket?.remoteAddress ?? null;
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
  const candidate = error as { code?: unknown; name?: unknown };
  return normalizeText(candidate.code ?? candidate.name, 120);
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}
