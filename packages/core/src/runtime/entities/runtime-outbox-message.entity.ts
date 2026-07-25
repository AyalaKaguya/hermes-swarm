import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { RuntimeRun } from "./runtime-run.entity.js";

export const RUNTIME_DISPATCH_TOPIC = "runtime.run.dispatch" as const;
export const RUNTIME_DISPATCH_SCHEMA_VERSION =
  "hermes.runtime-dispatch/v1" as const;

export type RuntimeOutboxStatus =
  | "dead"
  | "pending"
  | "published"
  | "publishing";

export type RuntimeDispatchPayload = {
  dispatchId: string;
  runId: string;
  schemaVersion: typeof RUNTIME_DISPATCH_SCHEMA_VERSION;
};

@Entity({ name: "runtime_outbox_messages" })
@Index("UQ_runtime_outbox_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index(
  "UQ_runtime_outbox_workspace_topic_dedupe",
  ["workspaceId", "topic", "dedupeKey"],
  { unique: true },
)
@Index(
  "UQ_runtime_outbox_workspace_run_topic",
  ["workspaceId", "runId", "topic"],
  { unique: true },
)
@Index("IDX_runtime_outbox_workspace_status_created", [
  "workspaceId",
  "status",
  "createdAt",
])
@Index(
  "IDX_runtime_outbox_dispatch_scan",
  ["status", "availableAt", "leaseExpiresAt", "id"],
  { where: `"status" IN ('pending', 'publishing')` },
)
@Index(
  "IDX_runtime_outbox_published_reconcile",
  ["publishedAt", "id"],
  { where: `"status" = 'published'` },
)
@Check(
  "CHK_runtime_outbox_topic",
  `"topic" = '${RUNTIME_DISPATCH_TOPIC}'`,
)
@Check(
  "CHK_runtime_outbox_schema_version",
  `"schema_version" = '${RUNTIME_DISPATCH_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_runtime_outbox_dedupe_key",
  `length(btrim("dedupe_key")) BETWEEN 1 AND 200`,
)
@Check(
  "CHK_runtime_outbox_payload",
  `jsonb_typeof("payload") = 'object'
    AND "payload" ?& ARRAY['schemaVersion', 'dispatchId', 'runId']
    AND ("payload" - 'schemaVersion' - 'dispatchId' - 'runId') = '{}'::jsonb
    AND "payload"->>'schemaVersion' = '${RUNTIME_DISPATCH_SCHEMA_VERSION}'
    AND "payload"->>'dispatchId' = "id"::text
    AND "payload"->>'runId' = "run_id"::text`,
)
@Check(
  "CHK_runtime_outbox_status",
  `"status" IN ('pending', 'publishing', 'published', 'dead')`,
)
@Check(
  "CHK_runtime_outbox_attempts",
  `"attempt_count" >= 0 AND "max_attempts" > 0 AND "attempt_count" <= "max_attempts"`,
)
@Check(
  "CHK_runtime_outbox_lease_shape",
  `(
    "lease_token" IS NULL
    AND "lease_owner" IS NULL
    AND "lease_expires_at" IS NULL
  ) OR (
    "lease_token" IS NOT NULL
    AND "lease_owner" IS NOT NULL
    AND "lease_expires_at" IS NOT NULL
  )`,
)
@Check(
  "CHK_runtime_outbox_publishing_lease",
  `(
    "status" = 'publishing' AND "lease_token" IS NOT NULL
  ) OR (
    "status" <> 'publishing' AND "lease_token" IS NULL
  )`,
)
@Check(
  "CHK_runtime_outbox_published_state",
  `(
    "status" = 'published' AND "published_at" IS NOT NULL
  ) OR (
    "status" <> 'published' AND "published_at" IS NULL
  )`,
)
export class RuntimeOutboxMessage extends WorkspaceOwnedBaseEntity {
  @Column({ name: "run_id", type: "uuid", update: false })
  runId!: string;

  @ManyToOne("RuntimeRun", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "run_id", referencedColumnName: "id" },
  ])
  run!: RuntimeRun;

  @Column({
    type: "varchar",
    length: 128,
    default: RUNTIME_DISPATCH_TOPIC,
    update: false,
  })
  topic!: typeof RUNTIME_DISPATCH_TOPIC;

  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: RUNTIME_DISPATCH_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof RUNTIME_DISPATCH_SCHEMA_VERSION;

  @Column({ name: "dedupe_key", type: "varchar", length: 200, update: false })
  dedupeKey!: string;

  @Column({ type: "jsonb", update: false })
  payload!: RuntimeDispatchPayload;

  @Column({ type: "varchar", length: 24, default: "pending" })
  status!: RuntimeOutboxStatus;

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

  @Column({ name: "lease_token", type: "uuid", nullable: true })
  leaseToken!: string | null;

  @Column({ name: "lease_owner", type: "varchar", length: 160, nullable: true })
  leaseOwner!: string | null;

  @Column({ name: "lease_expires_at", type: "timestamptz", nullable: true })
  leaseExpiresAt!: Date | null;

  @Column({ name: "published_at", type: "timestamptz", nullable: true })
  publishedAt!: Date | null;

  @Column({ name: "last_error_code", type: "varchar", length: 128, nullable: true })
  lastErrorCode!: string | null;
}
