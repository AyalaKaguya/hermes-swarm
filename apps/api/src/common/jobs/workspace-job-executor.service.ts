import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Workspace } from "@hermes-swarm/core";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";
import { IsNull, type Repository } from "typeorm";
import { WorkspaceContextService } from "../database/workspace-context.service.js";
import { RedisService } from "../redis/redis.service.js";
import type {
  WorkspaceJobEnvelope,
  WorkspaceJobExecutionOptions,
  WorkspaceJobExecutionResult,
} from "./workspace-job.types.js";

const DEFAULT_LOCK_TTL_MS = 5 * 60 * 1_000;
const DEFAULT_IDEMPOTENCY_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class WorkspaceJobExecutor {
  constructor(
    @InjectRepository(Workspace)
    private readonly workspaceRepository: Repository<Workspace>,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly redisService: RedisService,
  ) {}

  async execute<Payload, Result>(
    job: WorkspaceJobEnvelope<Payload>,
    handler: (payload: Payload) => Promise<Result>,
    options: WorkspaceJobExecutionOptions = {},
  ): Promise<WorkspaceJobExecutionResult<Result>> {
    assertWorkspaceJob(job);
    const current = this.workspaceContext.current(false);
    if (current && current.workspaceId !== job.workspaceId) {
      throw new Error("Workspace job cannot cross workspace context");
    }
    const workspaceExists = await this.workspaceRepository.exists({
      where: {
        deletedAt: IsNull(),
        id: job.workspaceId,
        status: "active",
      },
    });
    if (!workspaceExists) {
      throw new Error("Workspace job references an inactive or unknown workspace");
    }
    const redis = await this.redisService.getClient();
    const keys = workspaceJobKeys(job);
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

      const result = await this.workspaceContext.run(
        workspaceJobContext(job.workspaceId),
        () => handler(job.payload),
      );
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

export function workspaceJobKeys(job: WorkspaceJobEnvelope<unknown>) {
  const prefix = `jobs:workspace:${job.workspaceId}:${job.name}`;
  return {
    completed: `${prefix}:idempotency:${job.idempotencyKey}`,
    lock: `${prefix}:lock:${job.idempotencyKey}`,
  };
}

function assertWorkspaceJob(job: WorkspaceJobEnvelope<unknown>) {
  if (!job || typeof job !== "object") throw new Error("Workspace job is required");
  requireJobText(job.workspaceId, "workspaceId");
  requireJobText(job.idempotencyKey, "idempotencyKey");
  requireJobText(job.name, "name");
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(job.name)) {
    throw new Error("Workspace job name contains unsupported characters");
  }
}

function requireJobText(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Workspace job ${field} is required`);
  }
}

function workspaceJobContext(workspaceId: string) {
  return {
    scopeLevel: "workspace" as RequestScopeLevel,
    workspaceId,
  };
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
