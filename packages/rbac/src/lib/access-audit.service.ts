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
        organizationId: context.scope.organizationId ?? null,
        permission: context.definition.id,
        principalType: principal?.principalType ?? "anonymous",
        result,
        statusCode: input.statusCode ?? resolveStatusCode(input.error),
        targetTenantId:
          normalizeText(input.targetTenantId, 80) ?? resolveTargetTenantId(request),
        tenantId:
          principal?.principalType === "platform"
            ? null
            : principal?.tenantId ?? context.scope.tenantId ?? null,
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
