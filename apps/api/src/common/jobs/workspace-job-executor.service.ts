import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { InjectDataSource } from "@nestjs/typeorm";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";
import { DataSource, type EntityManager } from "typeorm";
import { WorkspaceContextService } from "../database/workspace-context.service.js";
import { WORKSPACE_DATABASE_GUCS } from "../database/workspace-database.constants.js";
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
    @InjectDataSource() private readonly workspaceDataSource: DataSource,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly redisService: RedisService,
  ) {}

  async execute<Payload, Result>(
    job: WorkspaceJobEnvelope<Payload>,
    handler: (payload: Payload) => Promise<Result>,
    options: WorkspaceJobExecutionOptions = {},
  ): Promise<WorkspaceJobExecutionResult<Result>> {
    assertWorkspaceJob(job);
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

      const result = await this.workspaceDataSource.transaction(async (manager) => {
        await configureWorkspaceJobRls(manager, job.workspaceId);
        return this.workspaceContext.run(
          workspaceJobContext(manager, job.workspaceId),
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

function workspaceJobContext(manager: EntityManager, workspaceId: string) {
  return {
    manager,
    scopeLevel: "workspace" as RequestScopeLevel,
    workspaceId,
  };
}

async function configureWorkspaceJobRls(manager: EntityManager, workspaceId: string) {
  await manager.query(
    `SELECT
      set_config('${WORKSPACE_DATABASE_GUCS.workspaceId}', $1, true),
      set_config('${WORKSPACE_DATABASE_GUCS.scopeLevel}', 'workspace', true)`,
    [workspaceId],
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
