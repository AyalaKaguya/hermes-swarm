import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  Department,
  DepartmentDispatchRelation,
  type DepartmentDispatchType,
} from "@hermes-swarm/core";
import { In } from "typeorm";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

const DEFAULT_MAX_HOPS = 8;
const MAX_ALLOWED_HOPS = 32;
const IDEMPOTENCY_TTL_MS = 5 * 60 * 1000;
const MAX_IDEMPOTENCY_ENTRIES = 1_000;

export type DepartmentDispatchPurpose =
  | "ticket_assignment"
  | "notification_targets"
  | "escalation_route";

export type DepartmentDispatchTarget = {
  departmentId: string;
  hop: number;
  organizationId: string;
  path: string[];
  policy: Record<string, unknown>;
  priority: number;
  relationId: string;
  type: DepartmentDispatchType;
};

export type DepartmentDispatchResolution = {
  cycleDetected: boolean;
  idempotencyKey: string;
  maxHops: number;
  purpose: DepartmentDispatchPurpose;
  sourceDepartmentId: string;
  targets: DepartmentDispatchTarget[];
  tenantId: string;
  truncated: boolean;
  visitedDepartmentIds: string[];
};

export type ResolveDepartmentDispatchInput = {
  idempotencyKey: string;
  maxHops?: number;
  purpose: DepartmentDispatchPurpose;
  sourceDepartmentId: string;
  tenantId: string;
  types: readonly DepartmentDispatchType[];
};

type IdempotencyEntry = {
  expiresAt: number;
  fingerprint: string;
  promise: Promise<DepartmentDispatchResolution>;
};

/**
 * Resolves enabled department routing edges without changing authorization.
 * Consumers must still authorize every resource and recipient independently.
 */
@Injectable()
export class DepartmentDispatchResolverService {
  private readonly idempotency = new Map<string, IdempotencyEntry>();

  constructor(private readonly tenantContext: TenantContextService) {}

  resolveTicketAssignment(input: Omit<ResolveDepartmentDispatchInput, "purpose" | "types">) {
    return this.resolve({
      ...input,
      purpose: "ticket_assignment",
      types: ["handoff", "fallback"],
    });
  }

  resolveNotificationTargets(
    input: Omit<ResolveDepartmentDispatchInput, "purpose" | "types">,
  ) {
    return this.resolve({
      ...input,
      purpose: "notification_targets",
      types: ["collaboration", "handoff", "escalation", "fallback"],
    });
  }

  resolveEscalationRoute(input: Omit<ResolveDepartmentDispatchInput, "purpose" | "types">) {
    return this.resolve({
      ...input,
      purpose: "escalation_route",
      types: ["escalation", "fallback"],
    });
  }

  resolve(input: ResolveDepartmentDispatchInput) {
    const normalized = normalizeInput(input);
    this.pruneIdempotencyCache();
    const cacheKey = `${normalized.tenantId}:${normalized.purpose}:${normalized.idempotencyKey}`;
    const fingerprint = JSON.stringify({
      maxHops: normalized.maxHops,
      sourceDepartmentId: normalized.sourceDepartmentId,
      types: normalized.types,
    });
    const existing = this.idempotency.get(cacheKey);
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new BadRequestException("调度幂等键已用于不同请求");
      }
      return existing.promise;
    }

    const promise = this.resolveGraph(normalized).catch((error) => {
      this.idempotency.delete(cacheKey);
      throw error;
    });
    this.idempotency.set(cacheKey, {
      expiresAt: Date.now() + IDEMPOTENCY_TTL_MS,
      fingerprint,
      promise,
    });
    return promise;
  }

  private async resolveGraph(
    input: ReturnType<typeof normalizeInput>,
  ): Promise<DepartmentDispatchResolution> {
    const source = await this.departments.findOne({
      select: { id: true, organizationId: true, tenantId: true },
      where: { id: input.sourceDepartmentId, status: "active", tenantId: input.tenantId },
    });
    if (!source) throw new NotFoundException("调度源部门不存在或不可用");

    const visited = new Set<string>([source.id]);
    const paths = new Map<string, string[]>([[source.id, [source.id]]]);
    const targets: DepartmentDispatchTarget[] = [];
    let frontier = [source.id];
    let cycleDetected = false;
    let truncated = false;

    for (let hop = 1; hop <= input.maxHops && frontier.length > 0; hop += 1) {
      const relations = await this.dispatchRelations.find({
        order: { priority: "ASC", createdAt: "ASC" },
        relations: { targetDepartment: true },
        where: {
          isEnabled: true,
          sourceDepartmentId: In(frontier),
          tenantId: input.tenantId,
          type: In([...input.types]),
        },
      });
      const next: string[] = [];
      for (const relation of relations) {
        if (
          relation.tenantId !== input.tenantId ||
          relation.targetDepartment?.tenantId !== input.tenantId
        ) {
          throw new BadRequestException("调度关系跨越租户边界");
        }
        const sourcePath = paths.get(relation.sourceDepartmentId) ?? [source.id];
        if (sourcePath.includes(relation.targetDepartmentId)) cycleDetected = true;
        if (visited.has(relation.targetDepartmentId)) continue;

        const path = [...sourcePath, relation.targetDepartmentId];
        visited.add(relation.targetDepartmentId);
        paths.set(relation.targetDepartmentId, path);
        next.push(relation.targetDepartmentId);
        targets.push({
          departmentId: relation.targetDepartmentId,
          hop,
          organizationId: relation.targetDepartment.organizationId,
          path,
          policy: relation.policy ?? {},
          priority: relation.priority,
          relationId: relation.id,
          type: relation.type,
        });
      }
      if (hop === input.maxHops && next.length > 0) truncated = true;
      frontier = next;
    }

    return {
      cycleDetected,
      idempotencyKey: input.idempotencyKey,
      maxHops: input.maxHops,
      purpose: input.purpose,
      sourceDepartmentId: input.sourceDepartmentId,
      targets,
      tenantId: input.tenantId,
      truncated,
      visitedDepartmentIds: [...visited],
    };
  }

  private pruneIdempotencyCache() {
    const now = Date.now();
    for (const [key, entry] of this.idempotency) {
      if (entry.expiresAt <= now) this.idempotency.delete(key);
    }
    while (this.idempotency.size >= MAX_IDEMPOTENCY_ENTRIES) {
      const oldest = this.idempotency.keys().next().value as string | undefined;
      if (!oldest) break;
      this.idempotency.delete(oldest);
    }
  }

  private get departments() {
    return this.tenantContext.repository(Department);
  }

  private get dispatchRelations() {
    return this.tenantContext.repository(DepartmentDispatchRelation);
  }
}

function normalizeInput(input: ResolveDepartmentDispatchInput) {
  const tenantId = requireIdentifier(input.tenantId, "租户");
  const sourceDepartmentId = requireIdentifier(input.sourceDepartmentId, "源部门");
  const idempotencyKey = requireIdentifier(input.idempotencyKey, "调度幂等键");
  const maxHops = input.maxHops ?? DEFAULT_MAX_HOPS;
  if (!Number.isInteger(maxHops) || maxHops < 1 || maxHops > MAX_ALLOWED_HOPS) {
    throw new BadRequestException(`最大调度跳数必须在 1 到 ${MAX_ALLOWED_HOPS} 之间`);
  }
  const types = [...new Set(input.types)];
  if (types.length === 0) throw new BadRequestException("调度类型不能为空");
  return { ...input, idempotencyKey, maxHops, sourceDepartmentId, tenantId, types };
}

function requireIdentifier(value: unknown, label: string) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized) throw new BadRequestException(`${label}不能为空`);
  return normalized;
}
