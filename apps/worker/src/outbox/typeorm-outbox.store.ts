import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  appendRuntimeRunStatusChanges,
  type RuntimeRunStatus,
} from "@hermes-swarm/core";
import { DataSource, type EntityManager } from "typeorm";
import { WorkerIdentityService } from "../runtime/worker-identity.service.js";
import type {
  ClaimedOutboxMessage,
  OutboxStore,
} from "./outbox.types.js";

type ClaimedRow = {
  attempt_count: number | string;
  id: string;
  lease_token: string;
  run_id: string;
  workspace_id: string;
};

type ReleasedRow = {
  id: string;
  run_id: string;
  run_status: string;
  status: string;
  workspace_id: string;
};

type RunStatusTransitionRow = {
  from_status: string;
  run_id: string;
  to_status: string;
  workspace_id: string;
};

const RUNTIME_RUN_STATUSES = new Set<RuntimeRunStatus>([
  "cancelled",
  "cancelling",
  "failed",
  "queued",
  "running",
  "succeeded",
  "timedOut",
  "waiting",
]);

export const OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE =
  "RUNTIME_OUTBOX_ATTEMPTS_EXHAUSTED";

@Injectable()
export class TypeOrmOutboxStore implements OutboxStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workerIdentity: WorkerIdentityService,
  ) {}

  async claimBatch(input: {
    batchSize: number;
    leaseMs: number;
    reconcileMs: number;
  }): Promise<ClaimedOutboxMessage[]> {
    return this.dataSource.transaction(async (manager) => {
      const exhaustedRunTransitions = (await manager.query(
        `
          WITH exhausted AS (
            SELECT
              message."id",
              message."run_id",
              message."workspace_id",
              runtime_run."status" AS "run_status",
              (
                runtime_run."status" IN ('running', 'cancelling')
                AND runtime_run."lease_expires_at" > clock_timestamp()
              ) AS "has_active_run_lease"
            FROM "runtime_outbox_messages" AS message
            INNER JOIN "runtime_runs" AS runtime_run
              ON runtime_run."id" = message."run_id"
              AND runtime_run."workspace_id" = message."workspace_id"
            WHERE (
              (
                message."status" = 'pending'
                AND message."available_at" <= clock_timestamp()
              )
              OR (
                message."status" = 'publishing'
                AND message."lease_expires_at" <= clock_timestamp()
              )
              OR (
                message."status" = 'published'
                AND message."published_at"
                  <= clock_timestamp()
                    - ($2::bigint * INTERVAL '1 millisecond')
                AND (
                  (
                    runtime_run."status" = 'queued'
                    AND runtime_run."available_at" <= clock_timestamp()
                  )
                  OR (
                    runtime_run."status" IN ('running', 'cancelling')
                    AND runtime_run."lease_expires_at" <= clock_timestamp()
                  )
                )
              )
            )
              AND message."attempt_count" >= message."max_attempts"
            ORDER BY message."available_at" ASC, message."id" ASC
            LIMIT $1
            FOR UPDATE OF message, runtime_run SKIP LOCKED
          ),
          resolved_messages AS (
            UPDATE "runtime_outbox_messages" AS message
            SET
              "status" = CASE
                WHEN exhausted."has_active_run_lease" THEN 'published'
                ELSE 'dead'
              END,
              "attempt_count" = CASE
                WHEN exhausted."has_active_run_lease" THEN 0
                ELSE message."attempt_count"
              END,
              "published_at" = CASE
                WHEN exhausted."has_active_run_lease" THEN clock_timestamp()
                ELSE NULL
              END,
              "lease_token" = NULL,
              "lease_owner" = NULL,
              "lease_expires_at" = NULL,
              "last_error_code" = CASE
                WHEN exhausted."has_active_run_lease" THEN NULL
                ELSE $3
              END,
              "updated_at" = clock_timestamp()
            FROM exhausted
            WHERE message."id" = exhausted."id"
              AND message."workspace_id" = exhausted."workspace_id"
            RETURNING
              exhausted."run_status" AS "from_status",
              message."run_id",
              message."status",
              message."workspace_id"
          )
          UPDATE "runtime_runs" AS runtime_run
          SET
            "status" = 'failed',
            "finished_at" = clock_timestamp(),
            "lease_token" = NULL,
            "lease_owner" = NULL,
            "lease_expires_at" = NULL,
            "heartbeat_at" = NULL,
            "last_error_code" = $3,
            "updated_at" = clock_timestamp()
          FROM resolved_messages
          WHERE runtime_run."id" = resolved_messages."run_id"
            AND runtime_run."workspace_id" = resolved_messages."workspace_id"
            AND resolved_messages."status" = 'dead'
            AND runtime_run."status" NOT IN (
              'cancelled', 'failed', 'succeeded', 'timedOut'
            )
          RETURNING
            resolved_messages."from_status",
            runtime_run."id" AS "run_id",
            runtime_run."status" AS "to_status",
            runtime_run."workspace_id"
        `,
        [
          input.batchSize,
          input.reconcileMs,
          OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE,
        ],
      )) as RunStatusTransitionRow[];
      await appendRunStatusTransitions(
        manager,
        exhaustedRunTransitions,
        OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE,
      );

      const leaseToken = randomUUID();
      const rows = (await manager.query(
        `
          WITH candidates AS (
            SELECT message."id", message."workspace_id"
            FROM "runtime_outbox_messages" AS message
            INNER JOIN "runtime_runs" AS runtime_run
              ON runtime_run."id" = message."run_id"
              AND runtime_run."workspace_id" = message."workspace_id"
            WHERE (
              (
                message."status" = 'pending'
                AND message."available_at" <= clock_timestamp()
              )
              OR (
                message."status" = 'publishing'
                AND message."lease_expires_at" <= clock_timestamp()
              )
              OR (
                message."status" = 'published'
                AND message."published_at"
                  <= clock_timestamp()
                    - ($5::bigint * INTERVAL '1 millisecond')
                AND (
                  (
                    runtime_run."status" = 'queued'
                    AND runtime_run."available_at" <= clock_timestamp()
                  )
                  OR (
                    runtime_run."status" IN ('running', 'cancelling')
                    AND runtime_run."lease_expires_at" <= clock_timestamp()
                  )
                )
              )
            )
              AND message."attempt_count" < message."max_attempts"
            ORDER BY message."available_at" ASC, message."id" ASC
            LIMIT $1
            FOR UPDATE OF message, runtime_run SKIP LOCKED
          )
          UPDATE "runtime_outbox_messages" AS message
          SET
            "status" = 'publishing',
            "attempt_count" = message."attempt_count" + 1,
            "published_at" = NULL,
            "lease_token" = $2,
            "lease_owner" = $3,
            "lease_expires_at" = clock_timestamp()
              + ($4::bigint * INTERVAL '1 millisecond'),
            "updated_at" = clock_timestamp()
          FROM candidates
          WHERE message."id" = candidates."id"
            AND message."workspace_id" = candidates."workspace_id"
          RETURNING
            message."id",
            message."run_id",
            message."workspace_id",
            message."attempt_count",
            message."lease_token"
        `,
        [
          input.batchSize,
          leaseToken,
          this.workerIdentity.id,
          input.leaseMs,
          input.reconcileMs,
        ],
      )) as ClaimedRow[];

      return rows.map((row) => ({
        attempt: readPositiveInteger(row.attempt_count, "attempt_count"),
        dispatchId: row.id,
        leaseToken: row.lease_token,
        runId: row.run_id,
        workspaceId: row.workspace_id,
      }));
    });
  }

  async markPublished(message: ClaimedOutboxMessage) {
    const rows = (await this.dataSource.query(
      `
        UPDATE "runtime_outbox_messages"
        SET
          "status" = 'published',
          "attempt_count" = 0,
          "published_at" = clock_timestamp(),
          "lease_token" = NULL,
          "lease_owner" = NULL,
          "lease_expires_at" = NULL,
          "last_error_code" = NULL,
          "updated_at" = clock_timestamp()
        WHERE "id" = $1
          AND "run_id" = $2
          AND "workspace_id" = $3
          AND "status" = 'publishing'
          AND "lease_token" = $4
        RETURNING "id"
      `,
      [
        message.dispatchId,
        message.runId,
        message.workspaceId,
        message.leaseToken,
      ],
    )) as Array<{ id: string }>;
    return rows.length === 1;
  }

  async releaseForRetry(
    message: ClaimedOutboxMessage,
    input: { errorCode: string; retryBackoffMs: number },
  ) {
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `
          WITH candidate AS (
            SELECT
              message."id",
              message."workspace_id",
              runtime_run."status" AS "run_status",
              (
                runtime_run."status" IN ('running', 'cancelling')
                AND runtime_run."lease_expires_at" > clock_timestamp()
              ) AS "has_active_run_lease"
            FROM "runtime_outbox_messages" AS message
            INNER JOIN "runtime_runs" AS runtime_run
              ON runtime_run."id" = message."run_id"
              AND runtime_run."workspace_id" = message."workspace_id"
            WHERE message."id" = $1
              AND message."run_id" = $2
              AND message."workspace_id" = $3
              AND message."status" = 'publishing'
              AND message."lease_token" = $4
            FOR UPDATE OF message, runtime_run
          )
          UPDATE "runtime_outbox_messages" AS message
          SET
            "status" = CASE
              WHEN candidate."has_active_run_lease" THEN 'published'
              WHEN message."attempt_count" >= message."max_attempts" THEN 'dead'
              ELSE 'pending'
            END,
            "attempt_count" = CASE
              WHEN candidate."has_active_run_lease" THEN 0
              ELSE message."attempt_count"
            END,
            "available_at" = clock_timestamp()
              + ($5::bigint * INTERVAL '1 millisecond'),
            "published_at" = CASE
              WHEN candidate."has_active_run_lease" THEN clock_timestamp()
              ELSE NULL
            END,
            "lease_token" = NULL,
            "lease_owner" = NULL,
            "lease_expires_at" = NULL,
            "last_error_code" = CASE
              WHEN candidate."has_active_run_lease" THEN NULL
              WHEN message."attempt_count" >= message."max_attempts" THEN $7
              ELSE $6
            END,
            "updated_at" = clock_timestamp()
          FROM candidate
          WHERE message."id" = candidate."id"
            AND message."workspace_id" = candidate."workspace_id"
          RETURNING
            message."id",
            message."run_id",
            candidate."run_status",
            message."workspace_id",
            message."status"
        `,
        [
          message.dispatchId,
          message.runId,
          message.workspaceId,
          message.leaseToken,
          input.retryBackoffMs,
          input.errorCode.slice(0, 128),
          OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE,
        ],
      )) as ReleasedRow[];
      if (rows.length === 0) return false;
      if (rows.length !== 1) throw storageInvariantError();
      const [released] = rows;
      if (!released) throw storageInvariantError();
      if (released.status === "dead") {
        await this.failAssociatedRun(
          manager,
          released.workspace_id,
          released.run_id,
          runtimeRunStatus(released.run_status),
        );
      } else if (
        released.status !== "pending" &&
        released.status !== "published"
      ) {
        throw storageInvariantError();
      }
      return true;
    });
  }

  private async failAssociatedRun(
    manager: EntityManager,
    workspaceId: string,
    runId: string,
    fromStatus: RuntimeRunStatus,
  ) {
    const rows = (await manager.query(
      `
        UPDATE "runtime_runs"
        SET
          "status" = 'failed',
          "finished_at" = clock_timestamp(),
          "lease_token" = NULL,
          "lease_owner" = NULL,
          "lease_expires_at" = NULL,
          "heartbeat_at" = NULL,
          "last_error_code" = $3,
          "updated_at" = clock_timestamp()
        WHERE "id" = $1
          AND "workspace_id" = $2
          AND "status" NOT IN (
            'cancelled', 'failed', 'succeeded', 'timedOut'
          )
          AND NOT (
            "status" IN ('running', 'cancelling')
            AND "lease_expires_at" > clock_timestamp()
          )
        RETURNING "id", "status"
      `,
      [runId, workspaceId, OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE],
    )) as Array<{ id: string; status: string }>;
    if (rows.length === 0) return false;
    if (rows.length !== 1) throw storageInvariantError();
    const [updated] = rows;
    if (!updated) throw storageInvariantError();
    await appendRuntimeRunStatusChanges(manager, [
      {
        from: fromStatus,
        reasonCode: OUTBOX_ATTEMPTS_EXHAUSTED_ERROR_CODE,
        runId,
        to: runtimeRunStatus(updated.status),
        workspaceId,
      },
    ]);
    return true;
  }
}

async function appendRunStatusTransitions(
  manager: EntityManager,
  rows: readonly RunStatusTransitionRow[],
  reasonCode: string,
) {
  await appendRuntimeRunStatusChanges(
    manager,
    rows.map((row) => ({
      from: runtimeRunStatus(row.from_status),
      reasonCode,
      runId: row.run_id,
      to: runtimeRunStatus(row.to_status),
      workspaceId: row.workspace_id,
    })),
  );
}

function runtimeRunStatus(value: unknown): RuntimeRunStatus {
  if (
    typeof value !== "string" ||
    !RUNTIME_RUN_STATUSES.has(value as RuntimeRunStatus)
  ) {
    throw storageInvariantError();
  }
  return value as RuntimeRunStatus;
}

function readPositiveInteger(value: number | string, name: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Database returned an invalid ${name}`);
  }
  return parsed;
}

function storageInvariantError() {
  return new Error("Outbox storage invariant failed");
}
