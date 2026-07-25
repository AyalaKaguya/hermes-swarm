import { Check, Column, Entity, Index } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";

export const RUNTIME_RUN_SCHEMA_VERSION = "hermes.runtime-run/v1" as const;

export type RuntimeRunStatus =
  | "cancelled"
  | "cancelling"
  | "failed"
  | "queued"
  | "running"
  | "succeeded"
  | "timedOut"
  | "waiting";

@Entity({ name: "runtime_runs" })
@Index("UQ_runtime_runs_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index(
  "UQ_runtime_runs_workspace_kind_key",
  ["workspaceId", "runKind", "idempotencyKey"],
  { unique: true },
)
@Index("IDX_runtime_runs_workspace_status_created", [
  "workspaceId",
  "status",
  "createdAt",
])
@Index(
  "IDX_runtime_runs_dispatch_scan",
  ["status", "availableAt", "leaseExpiresAt", "id"],
  { where: `"status" IN ('queued', 'running', 'cancelling')` },
)
@Check(
  "CHK_runtime_runs_kind",
  `"run_kind" ~ '^[a-z][a-z0-9-]*([.][a-z][a-z0-9-]*)+$'`,
)
@Check(
  "CHK_runtime_runs_schema_version",
  `"schema_version" = '${RUNTIME_RUN_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_runtime_runs_status",
  `"status" IN ('cancelled', 'cancelling', 'failed', 'queued', 'running', 'succeeded', 'timedOut', 'waiting')`,
)
@Check(
  "CHK_runtime_runs_idempotency_key",
  `length(btrim("idempotency_key")) BETWEEN 1 AND 200`,
)
@Check(
  "CHK_runtime_runs_request_digest",
  `"request_digest" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_runtime_runs_attempts",
  `"attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"`,
)
@Check(
  "CHK_runtime_runs_lease_generation",
  `"lease_generation" >= 0`,
)
@Check(
  "CHK_runtime_runs_lease_shape",
  `(
    "lease_token" IS NULL
    AND "lease_owner" IS NULL
    AND "lease_expires_at" IS NULL
    AND "heartbeat_at" IS NULL
  ) OR (
    "lease_token" IS NOT NULL
    AND "lease_owner" IS NOT NULL
    AND "lease_expires_at" IS NOT NULL
    AND "heartbeat_at" IS NOT NULL
    AND "lease_expires_at" > "heartbeat_at"
  )`,
)
@Check(
  "CHK_runtime_runs_running_lease",
  `(
    "status" IN ('running', 'cancelling') AND "lease_token" IS NOT NULL
  ) OR (
    "status" NOT IN ('running', 'cancelling') AND "lease_token" IS NULL
  )`,
)
@Check(
  "CHK_runtime_runs_started_state",
  `"status" NOT IN ('running', 'cancelling') OR "started_at" IS NOT NULL`,
)
@Check(
  "CHK_runtime_runs_finished_state",
  `(
    "status" IN ('succeeded', 'failed', 'cancelled', 'timedOut')
    AND "finished_at" IS NOT NULL
  ) OR (
    "status" IN ('queued', 'running', 'cancelling', 'waiting')
    AND "finished_at" IS NULL
  )`,
)
export class RuntimeRun extends WorkspaceOwnedBaseEntity {
  @Column({ name: "run_kind", type: "varchar", length: 128 })
  runKind!: string;

  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: RUNTIME_RUN_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof RUNTIME_RUN_SCHEMA_VERSION;

  @Column({ type: "varchar", length: 24, default: "queued" })
  status!: RuntimeRunStatus;

  @Column({ name: "idempotency_key", type: "varchar", length: 200 })
  idempotencyKey!: string;

  @Column({ name: "request_digest", type: "char", length: 64, update: false })
  requestDigest!: string;

  @Column({ name: "correlation_id", type: "varchar", length: 200, nullable: true })
  correlationId!: string | null;

  @Column({ name: "attempt_count", type: "integer", default: 0 })
  attemptCount!: number;

  @Column({ name: "max_attempts", type: "integer" })
  maxAttempts!: number;

  @Column({
    name: "available_at",
    type: "timestamptz",
    default: () => "CURRENT_TIMESTAMP",
  })
  availableAt!: Date;

  @Column({ name: "deadline_at", type: "timestamptz", nullable: true })
  deadlineAt!: Date | null;

  @Column({
    name: "cancellation_requested_at",
    type: "timestamptz",
    nullable: true,
  })
  cancellationRequestedAt!: Date | null;

  @Column({ name: "lease_token", type: "uuid", nullable: true })
  leaseToken!: string | null;

  @Column({ name: "lease_owner", type: "varchar", length: 160, nullable: true })
  leaseOwner!: string | null;

  @Column({ name: "lease_generation", type: "integer", default: 0 })
  leaseGeneration!: number;

  @Column({ name: "lease_expires_at", type: "timestamptz", nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ name: "heartbeat_at", type: "timestamptz", nullable: true })
  heartbeatAt!: Date | null;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  @Column({ name: "last_error_code", type: "varchar", length: 128, nullable: true })
  lastErrorCode!: string | null;
}
