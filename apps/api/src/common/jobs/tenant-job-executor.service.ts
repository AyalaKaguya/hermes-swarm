import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";
import { DataSource, type EntityManager } from "typeorm";
import { TenantContextService } from "../database/tenant-context.service.js";
import { TENANT_DATABASE_GUCS } from "../database/tenant-database.constants.js";
import { RedisService } from "../redis/redis.service.js";
import type {
  TenantJobEnvelope,
  TenantJobExecutionOptions,
  TenantJobExecutionResult,
} from "./tenant-job.types.js";

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class TenantJobExecutor {
  constructor(
    @InjectDataSource() private readonly tenantDataSource: DataSource,
    private readonly tenantContext: TenantContextService,
    private readonly redisService: RedisService,
  ) {}

  async execute<Payload, Result>(
    job: TenantJobEnvelope<Payload>,
    handler: (payload: Payload) => Promise<Result>,
    options: TenantJobExecutionOptions = {},
  ): Promise<TenantJobExecutionResult<Result>> {
    assertTenantJob(job);
    const redis = await this.redisService.getClient();
    const keys = tenantJobKeys(job);
    if (await redis.exists(keys.completed)) {
      return { status: "already-completed" };
    }

    const lockOwner = randomUUID();
    const acquired = await redis.set(keys.lock, lockOwner, {
      NX: true,
      PX: options.lockTtlMs ?? DEFAULT_LOCK_TTL_MS,
    });
    if (!acquired) return { status: "locked" };

    try {
      // Close the race between the first completed check and lock acquisition.
      if (await redis.exists(keys.completed)) {
        return { status: "already-completed" };
      }

      const result = await this.tenantDataSource.transaction(async (manager) => {
        await configureTenantJobRls(manager, job.tenantId);
        return this.tenantContext.run(
          tenantJobContext(manager, job.tenantId),
          () => handler(job.payload),
        );
      });
      await redis.set(
        keys.completed,
        JSON.stringify({ completedAt: new Date().toISOString() }),
        { EX: options.idempotencyTtlSeconds ?? DEFAULT_IDEMPOTENCY_TTL_SECONDS },
      );
      return { result, status: "completed" };
    } finally {
      await releaseOwnedLock(redis, keys.lock, lockOwner);
    }
  }
}

export function tenantJobKeys(job: TenantJobEnvelope<unknown>) {
  const prefix = `jobs:tenant:${job.tenantId}:${job.name}`;
  return {
    completed: `${prefix}:idempotency:${job.idempotencyKey}`,
    lock: `${prefix}:lock:${job.idempotencyKey}`,
  };
}

function assertTenantJob(job: TenantJobEnvelope<unknown>) {
  if (!job || typeof job !== "object") throw new Error("Tenant job is required");
  requireJobText(job.tenantId, "tenantId");
  requireJobText(job.idempotencyKey, "idempotencyKey");
  requireJobText(job.name, "name");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(job.name)) {
    throw new Error("Tenant job name contains unsupported characters");
  }
}

function requireJobText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Tenant job ${field} is required`);
  }
}

function tenantJobContext(manager: EntityManager, tenantId: string) {
  return {
    manager,
    organizationId: null,
    scopeLevel: "tenant" as RequestScopeLevel,
    tenantId,
  };
}

async function configureTenantJobRls(manager: EntityManager, tenantId: string) {
  await manager.query(
    `SELECT
      set_config('${TENANT_DATABASE_GUCS.tenantId}', $1, true),
      set_config('${TENANT_DATABASE_GUCS.scopeLevel}', 'tenant', true),
      set_config('${TENANT_DATABASE_GUCS.organizationId}', '', true)`,
    [tenantId],
  );
}

async function releaseOwnedLock(
  redis: Awaited<ReturnType<RedisService["getClient"]>>,
  key: string,
  owner: string,
) {
  await redis.eval(
    "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
    { arguments: [owner], keys: [key] },
  );
}
