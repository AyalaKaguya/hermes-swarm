import { Injectable, Logger } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  LoginAuditLog,
  type LoginAuditResult,
  type LoginAuditScopeType,
} from "@hermes-swarm/core";
import type { Repository } from "typeorm";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { parseAuthDevice } from "../auth/auth-device.js";

export type LoginAuditRecordInput = {
  actorId?: string | null;
  attemptedEmail: string;
  failureCode?: string | null;
  ipAddress?: string | null;
  result: LoginAuditResult;
  scopeType: LoginAuditScopeType;
  sessionId?: string | null;
  tenantId?: string | null;
  userAgent?: string | null;
};

@Injectable()
export class LoginAuditService {
  private readonly logger = new Logger(LoginAuditService.name);

  constructor(
    @InjectRepository(LoginAuditLog, PLATFORM_DATA_SOURCE)
    private readonly repository: Repository<LoginAuditLog>,
  ) {}

  /** Audit persistence is fail-open so an outage never changes authentication. */
  async record(input: LoginAuditRecordInput) {
    try {
      const userAgent = normalizeText(input.userAgent, 500);
      const device = parseAuthDevice(userAgent);
      await this.repository.insert({
        actorId: normalizeUuid(input.actorId),
        attemptedEmail:
          normalizeText(input.attemptedEmail, 160)?.toLowerCase() ?? "unknown",
        deviceLabel: userAgent ? device.deviceLabel : null,
        failureCode: normalizeText(input.failureCode, 120),
        ipAddress: normalizeText(input.ipAddress, 64),
        result: input.result,
        scopeType: input.scopeType,
        sessionId: normalizeUuid(input.sessionId),
        tenantId: normalizeUuid(input.tenantId),
        userAgent,
      });
    } catch (error) {
      this.logger.error(`Failed to persist login audit: ${String(error)}`);
    }
  }
}

function normalizeText(value: unknown, maxLength: number) {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeUuid(value: unknown) {
  const normalized = normalizeText(value, 36);
  return normalized && /^[0-9a-f-]{36}$/i.test(normalized) ? normalized : null;
}
