import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import type { RunOutcome } from "@hermes-swarm/agent-sdk";
import {
  appendRuntimeRunStatusChanges,
  RUNTIME_DISPATCH_TOPIC,
  type RuntimeRunStatus,
  type RuntimeRunStatusChange,
} from "@hermes-swarm/core";
import { DataSource, type EntityManager } from "typeorm";
import { WorkerIdentityService } from "./worker-identity.service.js";
import {
  RUNTIME_RUN_ERROR_CODES,
  type ClaimedRuntimeRun,
  type RuntimeHeartbeatResult,
  type RuntimeRunClaimResult,
  type RuntimeRunRequeueResult,
  type RuntimeStaleDeliveryRecoveryResult,
  type RuntimeRunStore,
} from "./runtime-run.types.js";

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
const TERMINAL_STATUSES = new Set<RuntimeRunStatus>([
  "cancelled",
  "failed",
  "succeeded",
  "timedOut",
]);
const QUEUE_REDELIVERY_GUARD_MS = 1_000;
const MAX_RUNTIME_RETRY_BACKOFF_MS = 30_000;

type RuntimeRunRow = {
  attempt_count: number | string;
  available_at: Date | string;
  cancellation_requested_at: Date | string | null;
  database_now: Date | string;
  deadline_at: Date | string | null;
  dispatch_id: string;
  lease_expires_at: Date | string | null;
  lease_generation: number | string;
  max_attempts: number | string;
  run_id: string;
  run_kind: string;
  status: string;
  workspace_id: string;
};

type RequeueRow = {
  attempt_count: number | string;
  cancellation_requested_at: Date | string | null;
  database_now: Date | string;
  deadline_at: Date | string | null;
  max_attempts: number | string;
  status: string;
};

type StatusTransitionRow = {
  from_status: string;
  reason_code?: string | null;
  run_id: string;
  to_status: string;
  workspace_id: string;
};

type StaleDeliveryRow = {
  database_now: Date | string;
  outbox_status: string;
  run_available_at: Date | string;
  run_lease_expires_at: Date | string | null;
  run_lease_generation: number | string;
  run_lease_token: string | null;
  run_status: string;
};

@Injectable()
export class TypeOrmRuntimeRunStore implements RuntimeRunStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workerIdentity: WorkerIdentityService,
  ) {}

  async claim(
    envelope: { dispatchId: string; runId: string },
    input: { leaseMs: number; rearmIfDeferred: boolean },
  ): Promise<RuntimeRunClaimResult> {
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `
          SELECT
            clock_timestamp() AS "database_now",
            message."id" AS "dispatch_id",
            runtime_run."id" AS "run_id",
            runtime_run."workspace_id",
            runtime_run."run_kind",
            runtime_run."status",
            runtime_run."attempt_count",
            runtime_run."max_attempts",
            runtime_run."available_at",
            runtime_run."deadline_at",
            runtime_run."cancellation_requested_at",
            runtime_run."lease_generation",
            runtime_run."lease_expires_at"
          FROM "runtime_outbox_messages" AS message
          INNER JOIN "runtime_runs" AS runtime_run
            ON runtime_run."workspace_id" = message."workspace_id"
            AND runtime_run."id" = message."run_id"
          WHERE message."id" = $1
            AND message."run_id" = $2
            AND message."topic" = $3
            AND message."status" <> 'dead'
          FOR UPDATE OF message, runtime_run
        `,
        [envelope.dispatchId, envelope.runId, RUNTIME_DISPATCH_TOPIC],
      )) as RuntimeRunRow[];

      if (rows.length === 0) {
        return { kind: "ignored", reason: "missing" };
      }
      if (rows.length !== 1) throw invariantError();
      const row = readRuntimeRunRow(rows[0]);
      const databaseNow = row.databaseNow;

      if (TERMINAL_STATUSES.has(row.status)) {
        return { kind: "ignored", reason: "terminal" };
      }

      const leaseActive =
        (row.status === "running" || row.status === "cancelling") &&
        row.leaseExpiresAt !== null &&
        row.leaseExpiresAt > databaseNow;
      const cancellationRequested =
        row.cancellationRequestedAt !== null || row.status === "cancelling";

      if (cancellationRequested) {
        if (!leaseActive) {
          await this.finishLocked(manager, row, {
            errorCode: null,
            finishedAt: databaseNow,
            status: "cancelled",
          });
          return { kind: "ignored", reason: "cancelled" };
        }
        if (row.status !== "cancelling") {
          const updated = (await manager.query(
            `
              UPDATE "runtime_runs"
              SET "status" = 'cancelling', "updated_at" = $3
              WHERE "id" = $1
                AND "workspace_id" = $2
                AND "status" = 'running'
              RETURNING "id"
            `,
            [row.runId, row.workspaceId, databaseNow],
          )) as Array<{ id: string }>;
          if (updated.length !== 1) throw invariantError();
          await appendStatusChange(manager, {
            from: row.status,
            reasonCode: null,
            runId: row.runId,
            to: "cancelling",
            workspaceId: row.workspaceId,
          });
        }
        return this.deferLocked(
          manager,
          row,
          row.leaseExpiresAt!,
          input.rearmIfDeferred,
          databaseNow,
        );
      }

      if (row.deadlineAt && row.deadlineAt <= databaseNow) {
        await this.finishLocked(manager, row, {
          errorCode: RUNTIME_RUN_ERROR_CODES.deadlineExceeded,
          finishedAt: databaseNow,
          status: "timedOut",
        });
        return { kind: "ignored", reason: "timed-out" };
      }

      if (row.status === "waiting") {
        return { kind: "ignored", reason: "waiting" };
      }

      if (leaseActive) {
        return this.deferLocked(
          manager,
          row,
          row.leaseExpiresAt!,
          input.rearmIfDeferred,
          databaseNow,
        );
      }

      if (row.status === "queued" && row.availableAt > databaseNow) {
        return this.deferLocked(
          manager,
          row,
          row.availableAt,
          input.rearmIfDeferred,
          databaseNow,
        );
      }

      if (row.attempt >= row.maxAttempts) {
        await this.finishLocked(manager, row, {
          errorCode: RUNTIME_RUN_ERROR_CODES.attemptsExhausted,
          finishedAt: databaseNow,
          status: "failed",
        });
        return { kind: "ignored", reason: "attempts-exhausted" };
      }

      if (row.status !== "queued" && row.status !== "running") {
        throw invariantError();
      }

      const leaseToken = randomUUID();
      const nextGeneration = row.fencingGeneration + 1;
      const nextAttempt = row.attempt + 1;
      const updated = (await manager.query(
        `
          UPDATE "runtime_runs"
          SET
            "status" = 'running',
            "attempt_count" = $5,
            "lease_token" = $6,
            "lease_owner" = $7,
            "lease_generation" = $8,
            "lease_expires_at" = $4 + ($9::bigint * INTERVAL '1 millisecond'),
            "heartbeat_at" = $4,
            "started_at" = COALESCE("started_at", $4),
            "finished_at" = NULL,
            "updated_at" = $4
          WHERE "id" = $1
            AND "workspace_id" = $2
            AND "lease_generation" = $3
            AND "status" IN ('queued', 'running')
          RETURNING "id"
        `,
        [
          row.runId,
          row.workspaceId,
          row.fencingGeneration,
          databaseNow,
          nextAttempt,
          leaseToken,
          this.workerIdentity.id,
          nextGeneration,
          input.leaseMs,
        ],
      )) as Array<{ id: string }>;
      if (updated.length !== 1) throw invariantError();
      await appendStatusChange(manager, {
        from: row.status,
        reasonCode: null,
        runId: row.runId,
        to: "running",
        workspaceId: row.workspaceId,
      });

      return {
        kind: "claimed",
        run: Object.freeze({
          attempt: nextAttempt,
          deadlineDelayMs:
            row.deadlineAt === null
              ? null
              : Math.max(0, row.deadlineAt.getTime() - databaseNow.getTime()),
          dispatchId: row.dispatchId,
          fencingGeneration: nextGeneration,
          leaseToken,
          maxAttempts: row.maxAttempts,
          runId: row.runId,
          runKind: row.runKind,
          workspaceId: row.workspaceId,
        }),
      };
    });
  }

  async heartbeat(
    run: ClaimedRuntimeRun,
    input: { leaseMs: number },
  ): Promise<RuntimeHeartbeatResult> {
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `
          WITH database_clock AS MATERIALIZED (
            SELECT clock_timestamp() AS "now"
          ),
          candidate AS MATERIALIZED (
            SELECT
              runtime_run."id",
              runtime_run."workspace_id",
              runtime_run."status" AS "from_status",
              database_clock."now" AS "occurred_at"
            FROM "runtime_runs" AS runtime_run
            CROSS JOIN database_clock
            WHERE runtime_run."id" = $1
              AND runtime_run."workspace_id" = $2
              AND runtime_run."lease_token" = $3
              AND runtime_run."lease_generation" = $4
              AND runtime_run."status" IN ('running', 'cancelling')
              AND runtime_run."lease_expires_at" > database_clock."now"
            FOR UPDATE OF runtime_run
          )
          UPDATE "runtime_runs" AS runtime_run
          SET
            "status" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NOT NULL
                THEN 'cancelling'
              WHEN runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN 'timedOut'
              ELSE runtime_run."status"
            END,
            "finished_at" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NULL
                AND runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN candidate."occurred_at"
              ELSE runtime_run."finished_at"
            END,
            "last_error_code" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NULL
                AND runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN $6
              ELSE runtime_run."last_error_code"
            END,
            "lease_token" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NULL
                AND runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN NULL
              ELSE runtime_run."lease_token"
            END,
            "lease_owner" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NULL
                AND runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN NULL
              ELSE runtime_run."lease_owner"
            END,
            "lease_expires_at" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NULL
                AND runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN NULL
              ELSE candidate."occurred_at" +
                ($5::bigint * INTERVAL '1 millisecond')
            END,
            "heartbeat_at" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NULL
                AND runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN NULL
              ELSE candidate."occurred_at"
            END,
            "updated_at" = candidate."occurred_at"
          FROM candidate
          WHERE runtime_run."id" = candidate."id"
            AND runtime_run."workspace_id" = candidate."workspace_id"
          RETURNING
            candidate."from_status",
            runtime_run."id" AS "run_id",
            runtime_run."status" AS "to_status",
            runtime_run."workspace_id"
        `,
        [
          run.runId,
          run.workspaceId,
          run.leaseToken,
          run.fencingGeneration,
          input.leaseMs,
          RUNTIME_RUN_ERROR_CODES.deadlineExceeded,
        ],
      )) as StatusTransitionRow[];
      if (rows.length === 0) return "stale";
      if (rows.length !== 1) throw invariantError();
      const transition = readStatusTransition(rows[0]);
      await appendStatusChange(manager, {
        ...transition,
        reasonCode:
          transition.to === "timedOut"
            ? RUNTIME_RUN_ERROR_CODES.deadlineExceeded
            : null,
      });
      if (transition.to === "timedOut") return "timed-out";
      if (transition.to === "cancelling") return "cancelling";
      if (transition.to !== "running") throw invariantError();
      return "active";
    });
  }

  async finish(
    run: ClaimedRuntimeRun,
    outcome: RunOutcome,
  ) {
    const requestedStatus = outcome.status;
    const errorCode =
      outcome.status === "failed" || outcome.status === "timedOut"
        ? normalizeErrorCode(outcome.failure.code)
        : null;
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `
          WITH database_clock AS MATERIALIZED (
            SELECT clock_timestamp() AS "now"
          ),
          candidate AS MATERIALIZED (
            SELECT
              runtime_run."id",
              runtime_run."workspace_id",
              runtime_run."status" AS "from_status",
              database_clock."now" AS "occurred_at"
            FROM "runtime_runs" AS runtime_run
            CROSS JOIN database_clock
            WHERE runtime_run."id" = $1
              AND runtime_run."workspace_id" = $2
              AND runtime_run."lease_token" = $3
              AND runtime_run."lease_generation" = $4
              AND runtime_run."status" IN ('running', 'cancelling')
              AND runtime_run."lease_expires_at" > database_clock."now"
            FOR UPDATE OF runtime_run
          )
          UPDATE "runtime_runs" AS runtime_run
          SET
            "status" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NOT NULL
                THEN 'cancelled'
              WHEN runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN 'timedOut'
              ELSE $5
            END,
            "finished_at" = candidate."occurred_at",
            "last_error_code" = CASE
              WHEN runtime_run."cancellation_requested_at" IS NOT NULL THEN NULL
              WHEN runtime_run."deadline_at" IS NOT NULL
                AND runtime_run."deadline_at" <= candidate."occurred_at"
                THEN $7
              WHEN $5 IN ('failed', 'timedOut') THEN $6
              ELSE NULL
            END,
            "lease_token" = NULL,
            "lease_owner" = NULL,
            "lease_expires_at" = NULL,
            "heartbeat_at" = NULL,
            "updated_at" = candidate."occurred_at"
          FROM candidate
          WHERE runtime_run."id" = candidate."id"
            AND runtime_run."workspace_id" = candidate."workspace_id"
          RETURNING
            candidate."from_status",
            runtime_run."id" AS "run_id",
            runtime_run."last_error_code" AS "reason_code",
            runtime_run."status" AS "to_status",
            runtime_run."workspace_id"
        `,
        [
          run.runId,
          run.workspaceId,
          run.leaseToken,
          run.fencingGeneration,
          requestedStatus,
          errorCode,
          RUNTIME_RUN_ERROR_CODES.deadlineExceeded,
        ],
      )) as StatusTransitionRow[];
      if (rows.length === 0) return false;
      if (rows.length !== 1) throw invariantError();
      const transition = readStatusTransition(rows[0]);
      await appendStatusChange(manager, {
        ...transition,
        reasonCode:
          transition.to === "failed" || transition.to === "timedOut"
            ? persistedReasonCode(rows[0].reason_code)
            : null,
      });
      return true;
    });
  }

  async recoverStaleDelivery(
    run: ClaimedRuntimeRun,
  ): Promise<RuntimeStaleDeliveryRecoveryResult> {
    return this.dataSource.transaction(async (manager) => {
      const rows = (await manager.query(
        `
          SELECT
            clock_timestamp() AS "database_now",
            message."status" AS "outbox_status",
            runtime_run."status" AS "run_status",
            runtime_run."available_at" AS "run_available_at",
            runtime_run."lease_token" AS "run_lease_token",
            runtime_run."lease_generation" AS "run_lease_generation",
            runtime_run."lease_expires_at" AS "run_lease_expires_at"
          FROM "runtime_outbox_messages" AS message
          INNER JOIN "runtime_runs" AS runtime_run
            ON runtime_run."workspace_id" = message."workspace_id"
            AND runtime_run."id" = message."run_id"
          WHERE message."id" = $1
            AND message."run_id" = $2
            AND message."workspace_id" = $3
            AND message."topic" = $4
          FOR UPDATE OF message, runtime_run
        `,
        [
          run.dispatchId,
          run.runId,
          run.workspaceId,
          RUNTIME_DISPATCH_TOPIC,
        ],
      )) as StaleDeliveryRow[];
      if (rows.length !== 1) throw invariantError("stale_delivery");
      const row = readStaleDeliveryRow(rows[0]);

      if (TERMINAL_STATUSES.has(row.runStatus)) return "settled";
      if (row.runStatus === "waiting") return "settled";

      const activeLease =
        (row.runStatus === "running" || row.runStatus === "cancelling") &&
        row.runLeaseExpiresAt !== null &&
        row.runLeaseExpiresAt > row.databaseNow;
      const sameLease =
        row.runLeaseToken === run.leaseToken &&
        row.runLeaseGeneration === run.fencingGeneration;
      if (activeLease && !sameLease) return "ownedElsewhere";
      if (
        row.outboxStatus !== "pending" &&
        row.outboxStatus !== "publishing" &&
        row.outboxStatus !== "published"
      ) {
        throw invariantError("stale_delivery_outbox");
      }

      if (
        row.runStatus !== "queued" &&
        row.runStatus !== "running" &&
        row.runStatus !== "cancelling"
      ) {
        throw invariantError("stale_delivery_status");
      }

      let retryAt = row.databaseNow;
      if (activeLease && row.runLeaseExpiresAt) {
        retryAt = row.runLeaseExpiresAt;
      } else if (
        row.runStatus === "queued" &&
        row.runAvailableAt > row.databaseNow
      ) {
        retryAt = row.runAvailableAt;
      }
      const rearmed = (await manager.query(
        `
          UPDATE "runtime_outbox_messages"
          SET
            "status" = 'pending',
            "available_at" = GREATEST(
              $5::timestamptz,
              clock_timestamp() + ($6::bigint * INTERVAL '1 millisecond')
            ),
            "published_at" = NULL,
            "lease_token" = NULL,
            "lease_owner" = NULL,
            "lease_expires_at" = NULL,
            "last_error_code" = 'RUNTIME_RUN_STALE_DELIVERY_RECOVERED',
            "updated_at" = clock_timestamp()
          WHERE "id" = $1
            AND "run_id" = $2
            AND "workspace_id" = $3
            AND "topic" = $4
            AND "status" IN ('pending', 'publishing', 'published')
          RETURNING "id"
        `,
        [
          run.dispatchId,
          run.runId,
          run.workspaceId,
          RUNTIME_DISPATCH_TOPIC,
          retryAt,
          QUEUE_REDELIVERY_GUARD_MS,
        ],
      )) as Array<{ id: string }>;
      if (rearmed.length !== 1) {
        throw invariantError("stale_delivery_outbox");
      }
      return "rearmed";
    });
  }

  async requeue(
    run: ClaimedRuntimeRun,
    input: {
      errorCode: string;
      rearmOutbox: boolean;
      retryBackoffMs: number;
    },
  ): Promise<RuntimeRunRequeueResult> {
    return this.dataSource.transaction(async (manager) => {
      const errorCode = normalizeErrorCode(input.errorCode);
      const retryBackoffMs = boundedMilliseconds(
        input.retryBackoffMs,
        "retryBackoffMs",
        MAX_RUNTIME_RETRY_BACKOFF_MS,
      );
      const rows = (await manager.query(
        `
          WITH database_clock AS MATERIALIZED (
            SELECT clock_timestamp() AS "now"
          )
          SELECT
            database_clock."now" AS "database_now",
            runtime_run."status",
            runtime_run."attempt_count",
            runtime_run."max_attempts",
            runtime_run."deadline_at",
            runtime_run."cancellation_requested_at"
          FROM "runtime_runs" AS runtime_run
          CROSS JOIN database_clock
          WHERE runtime_run."id" = $1
            AND runtime_run."workspace_id" = $2
            AND runtime_run."lease_token" = $3
            AND runtime_run."lease_generation" = $4
            AND runtime_run."status" IN ('running', 'cancelling')
            AND runtime_run."lease_expires_at" > database_clock."now"
          FOR UPDATE OF runtime_run
        `,
        [
          run.runId,
          run.workspaceId,
          run.leaseToken,
          run.fencingGeneration,
        ],
      )) as RequeueRow[];
      if (rows.length === 0) return "stale";
      if (rows.length !== 1) throw invariantError();
      const row = readRequeueRow(rows[0]);
      const databaseNow = row.databaseNow;

      if (row.cancellationRequestedAt || row.status === "cancelling") {
        await this.finishClaimLocked(
          manager,
          run,
          row.status,
          databaseNow,
          "cancelled",
          null,
        );
        return "finished";
      }
      if (row.deadlineAt && row.deadlineAt <= databaseNow) {
        await this.finishClaimLocked(
          manager,
          run,
          row.status,
          databaseNow,
          "timedOut",
          RUNTIME_RUN_ERROR_CODES.deadlineExceeded,
        );
        return "finished";
      }
      if (row.attempt >= row.maxAttempts) {
        await this.finishClaimLocked(
          manager,
          run,
          row.status,
          databaseNow,
          "failed",
          errorCode,
        );
        return "finished";
      }

      const updated = (await manager.query(
        `
          UPDATE "runtime_runs"
          SET
            "status" = 'queued',
            "available_at" = $5 +
              ($6::bigint * INTERVAL '1 millisecond'),
            "last_error_code" = $7,
            "lease_token" = NULL,
            "lease_owner" = NULL,
            "lease_expires_at" = NULL,
            "heartbeat_at" = NULL,
            "updated_at" = $5
          WHERE "id" = $1
            AND "workspace_id" = $2
            AND "lease_token" = $3
            AND "lease_generation" = $4
            AND "status" = 'running'
          RETURNING "id", "available_at"
        `,
        [
          run.runId,
          run.workspaceId,
          run.leaseToken,
          run.fencingGeneration,
          databaseNow,
          retryBackoffMs,
          errorCode,
        ],
      )) as Array<{ available_at: Date | string; id: string }>;
      if (updated.length !== 1) throw invariantError();
      await appendStatusChange(manager, {
        from: row.status,
        reasonCode: errorCode,
        runId: run.runId,
        to: "queued",
        workspaceId: run.workspaceId,
      });
      const availableAt = validDate(
        updated[0].available_at,
        "requeued_available_at",
      );

      if (!input.rearmOutbox) return "requeued";
      const rearmed = await this.rearmDispatch(
        manager,
        run.dispatchId,
        run.runId,
        run.workspaceId,
        availableAt,
      );
      if (rearmed) return "requeued";

      const failed = (await manager.query(
        `
          UPDATE "runtime_runs"
          SET
            "status" = 'failed',
            "finished_at" = $3,
            "last_error_code" = $4,
            "updated_at" = $3
          WHERE "id" = $1
            AND "workspace_id" = $2
            AND "status" = 'queued'
          RETURNING "id"
        `,
        [
          run.runId,
          run.workspaceId,
          databaseNow,
          RUNTIME_RUN_ERROR_CODES.outboxMissing,
        ],
      )) as Array<{ id: string }>;
      if (failed.length !== 1) throw invariantError();
      await appendStatusChange(manager, {
        from: "queued",
        reasonCode: RUNTIME_RUN_ERROR_CODES.outboxMissing,
        runId: run.runId,
        to: "failed",
        workspaceId: run.workspaceId,
      });
      return "finished";
    });
  }

  private async deferLocked(
    manager: EntityManager,
    row: ParsedRuntimeRunRow,
    retryAt: Date,
    shouldRearm: boolean,
    now: Date,
  ): Promise<RuntimeRunClaimResult> {
    const durableRetryAt = shouldRearm
      ? new Date(
          Math.max(
            retryAt.getTime(),
            now.getTime() + QUEUE_REDELIVERY_GUARD_MS,
          ),
        )
      : retryAt;
    const rearmed = shouldRearm
      ? await this.rearmDispatch(
          manager,
          row.dispatchId,
          row.runId,
          row.workspaceId,
          durableRetryAt,
        )
      : false;
    return {
      kind: "deferred",
      rearmed,
      retryAt: new Date(durableRetryAt.getTime()),
    };
  }

  private async rearmDispatch(
    manager: EntityManager,
    dispatchId: string,
    runId: string,
    workspaceId: string,
    availableAt: Date,
  ) {
    const rows = (await manager.query(
      `
        UPDATE "runtime_outbox_messages"
        SET
          "status" = 'pending',
          "available_at" = $4,
          "published_at" = NULL,
          "lease_token" = NULL,
          "lease_owner" = NULL,
          "lease_expires_at" = NULL,
          "last_error_code" = 'RUNTIME_RUN_DELIVERY_DEFERRED',
          "updated_at" = CURRENT_TIMESTAMP
        WHERE "id" = $1
          AND "run_id" = $2
          AND "workspace_id" = $3
          AND "status" <> 'dead'
        RETURNING "id"
      `,
      [dispatchId, runId, workspaceId, availableAt],
    )) as Array<{ id: string }>;
    return rows.length === 1;
  }

  private async finishLocked(
    manager: EntityManager,
    row: ParsedRuntimeRunRow,
    input: {
      errorCode: string | null;
      finishedAt: Date;
      status: "cancelled" | "failed" | "timedOut";
    },
  ) {
    const rows = (await manager.query(
      `
        UPDATE "runtime_runs"
        SET
          "status" = $3,
          "finished_at" = $4,
          "last_error_code" = $5,
          "lease_token" = NULL,
          "lease_owner" = NULL,
          "lease_expires_at" = NULL,
          "heartbeat_at" = NULL,
          "updated_at" = $4
        WHERE "id" = $1
          AND "workspace_id" = $2
          AND "status" NOT IN ('cancelled', 'failed', 'succeeded', 'timedOut')
        RETURNING "id"
      `,
      [
        row.runId,
        row.workspaceId,
        input.status,
        input.finishedAt,
        input.errorCode,
      ],
    )) as Array<{ id: string }>;
    if (rows.length !== 1) throw invariantError();
    await appendStatusChange(manager, {
      from: row.status,
      reasonCode: input.errorCode,
      runId: row.runId,
      to: input.status,
      workspaceId: row.workspaceId,
    });
  }

  private async finishClaimLocked(
    manager: EntityManager,
    run: ClaimedRuntimeRun,
    fromStatus: RuntimeRunStatus,
    finishedAt: Date,
    status: "cancelled" | "failed" | "timedOut",
    errorCode: string | null,
  ) {
    const rows = (await manager.query(
      `
        UPDATE "runtime_runs"
        SET
          "status" = $5,
          "finished_at" = $6,
          "last_error_code" = $7,
          "lease_token" = NULL,
          "lease_owner" = NULL,
          "lease_expires_at" = NULL,
          "heartbeat_at" = NULL,
          "updated_at" = $6
        WHERE "id" = $1
          AND "workspace_id" = $2
          AND "lease_token" = $3
          AND "lease_generation" = $4
          AND "status" IN ('running', 'cancelling')
        RETURNING "id"
      `,
      [
        run.runId,
        run.workspaceId,
        run.leaseToken,
        run.fencingGeneration,
        status,
        finishedAt,
        errorCode,
      ],
    )) as Array<{ id: string }>;
    if (rows.length !== 1) throw invariantError();
    await appendStatusChange(manager, {
      from: fromStatus,
      reasonCode: errorCode,
      runId: run.runId,
      to: status,
      workspaceId: run.workspaceId,
    });
  }
}

type ParsedRuntimeRunRow = Readonly<{
  attempt: number;
  availableAt: Date;
  cancellationRequestedAt: Date | null;
  databaseNow: Date;
  deadlineAt: Date | null;
  dispatchId: string;
  fencingGeneration: number;
  leaseExpiresAt: Date | null;
  maxAttempts: number;
  runId: string;
  runKind: string;
  status: RuntimeRunStatus;
  workspaceId: string;
}>;

function readRuntimeRunRow(row: RuntimeRunRow): ParsedRuntimeRunRow {
  return {
    attempt: nonNegativeInteger(row.attempt_count, "attempt_count"),
    availableAt: validDate(row.available_at, "available_at"),
    cancellationRequestedAt: nullableDate(
      row.cancellation_requested_at,
      "cancellation_requested_at",
    ),
    databaseNow: validDate(row.database_now, "database_now"),
    deadlineAt: nullableDate(row.deadline_at, "deadline_at"),
    dispatchId: uuid(row.dispatch_id, "dispatch_id"),
    fencingGeneration: nonNegativeInteger(
      row.lease_generation,
      "lease_generation",
    ),
    leaseExpiresAt: nullableDate(row.lease_expires_at, "lease_expires_at"),
    maxAttempts: positiveInteger(row.max_attempts, "max_attempts"),
    runId: uuid(row.run_id, "run_id"),
    runKind: boundedText(row.run_kind, "run_kind", 128),
    status: runtimeRunStatus(row.status, "status"),
    workspaceId: uuid(row.workspace_id, "workspace_id"),
  };
}

function readRequeueRow(row: RequeueRow) {
  return {
    attempt: nonNegativeInteger(row.attempt_count, "attempt_count"),
    cancellationRequestedAt: nullableDate(
      row.cancellation_requested_at,
      "cancellation_requested_at",
    ),
    databaseNow: validDate(row.database_now, "database_now"),
    deadlineAt: nullableDate(row.deadline_at, "deadline_at"),
    maxAttempts: positiveInteger(row.max_attempts, "max_attempts"),
    status: runtimeRunStatus(row.status, "status"),
  };
}

function readStaleDeliveryRow(row: StaleDeliveryRow) {
  return {
    databaseNow: validDate(row.database_now, "database_now"),
    outboxStatus: boundedText(row.outbox_status, "outbox_status", 24),
    runAvailableAt: validDate(row.run_available_at, "run_available_at"),
    runLeaseExpiresAt: nullableDate(
      row.run_lease_expires_at,
      "run_lease_expires_at",
    ),
    runLeaseGeneration: nonNegativeInteger(
      row.run_lease_generation,
      "run_lease_generation",
    ),
    runLeaseToken: nullableUuid(row.run_lease_token, "run_lease_token"),
    runStatus: runtimeRunStatus(row.run_status, "run_status"),
  };
}

function readStatusTransition(row: StatusTransitionRow) {
  return {
    from: runtimeRunStatus(row.from_status, "from_status"),
    runId: uuid(row.run_id, "run_id"),
    to: runtimeRunStatus(row.to_status, "to_status"),
    workspaceId: uuid(row.workspace_id, "workspace_id"),
  };
}

async function appendStatusChange(
  manager: EntityManager,
  change: RuntimeRunStatusChange,
) {
  if (change.from === change.to) return;
  await appendRuntimeRunStatusChanges(manager, [change]);
}

function validDate(value: unknown, name: string) {
  const date =
    value instanceof Date
      ? new Date(value.getTime())
      : new Date(String(value));
  if (!Number.isFinite(date.getTime())) throw invariantError(name);
  return date;
}

function nullableDate(value: unknown, name: string) {
  return value === null || value === undefined ? null : validDate(value, name);
}

function positiveInteger(value: unknown, name: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw invariantError(name);
  return parsed;
}

function nonNegativeInteger(value: unknown, name: string) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw invariantError(name);
  return parsed;
}

function boundedMilliseconds(
  value: unknown,
  name: string,
  maximum: number,
) {
  const parsed = nonNegativeInteger(value, name);
  if (parsed > maximum) throw invariantError(name);
  return parsed;
}

function boundedText(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw invariantError(name);
  }
  return value;
}

function runtimeRunStatus(value: unknown, name: string): RuntimeRunStatus {
  const status = boundedText(value, name, 24) as RuntimeRunStatus;
  if (!RUNTIME_RUN_STATUSES.has(status)) throw invariantError(name);
  return status;
}

function persistedReasonCode(value: unknown) {
  return boundedText(value, "reason_code", 128);
}

function uuid(value: unknown, name: string) {
  const text = boundedText(value, name, 36);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) {
    throw invariantError(name);
  }
  return text.toLowerCase();
}

function nullableUuid(value: unknown, name: string) {
  return value === null || value === undefined ? null : uuid(value, name);
}

function normalizeErrorCode(value: string) {
  const code = value.trim().slice(0, 128);
  return code || RUNTIME_RUN_ERROR_CODES.handlerExecutionFailed;
}

function invariantError(field?: string) {
  return new Error(
    field
      ? `Runtime run storage invariant failed (${field})`
      : "Runtime run storage invariant failed",
  );
}
