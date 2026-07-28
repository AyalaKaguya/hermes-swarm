import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from "typeorm";
import type { Account } from "../../identity/entities/account.entity.js";
import type { IntegrationToken } from "../../identity/entities/integration-token.entity.js";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { RuntimeRun } from "../../runtime/entities/runtime-run.entity.js";

export const ANALYSIS_QUERY_RUN_SCHEMA_VERSION =
  "hermes.analytics.query-run/v1" as const;

export type AnalysisQueryRunStatus =
  | "cancelled"
  | "cancelling"
  | "failed"
  | "queued"
  | "running"
  | "succeeded"
  | "timedOut"
  | "waiting";

export type AnalysisQueryRunPrincipalType = "integration" | "workspace";
export type AnalysisQueryRunQuery = Record<string, unknown>;
export type AnalysisQueryRunInlineResult = Record<string, unknown>;

@Entity({ name: "analysis_query_runs" })
@Index("UQ_analysis_query_runs_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index("IDX_analysis_query_runs_workspace_status_created", [
  "workspaceId",
  "status",
  "createdAt",
])
@Index("IDX_analysis_query_runs_expiration", ["expiresAt", "id"], {
  where: `"status" IN ('cancelled', 'failed', 'succeeded', 'timedOut')`,
})
@Check(
  "CHK_analysis_query_runs_schema_version",
  `"schema_version" = '${ANALYSIS_QUERY_RUN_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_analysis_query_runs_status",
  `"status" IN ('cancelled', 'cancelling', 'failed', 'queued', 'running', 'succeeded', 'timedOut', 'waiting')`,
)
@Check(
  "CHK_analysis_query_runs_normalized_query",
  `jsonb_typeof("normalized_query") = 'object'`,
)
@Check(
  "CHK_analysis_query_runs_query_digest",
  `"query_digest" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_analysis_query_runs_policy_digest",
  `"policy_digest" IS NULL OR "policy_digest" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_analysis_query_runs_source_key",
  `"source_key" ~ '^[a-z][a-z0-9]*([._-][a-z0-9]+)*$'`,
)
@Check(
  "CHK_analysis_query_runs_revisions",
  `length(btrim("source_revision")) BETWEEN 1 AND 128
    AND length(btrim("policy_revision")) BETWEEN 1 AND 128`,
)
@Check(
  "CHK_analysis_query_runs_request_id",
  `length(btrim("request_id")) BETWEEN 1 AND 200`,
)
@Check(
  "CHK_analysis_query_runs_principal",
  `(
    "principal_type" = 'integration'
    AND "integration_token_id" IS NOT NULL
  ) OR (
    "principal_type" = 'workspace'
    AND "integration_token_id" IS NULL
  )`,
)
@Check(
  "CHK_analysis_query_runs_inline_result",
  `(
    "inline_result" IS NULL
  ) OR (
    "status" = 'succeeded'
    AND jsonb_typeof("inline_result") = 'object'
  )`,
)
@Check(
  "CHK_analysis_query_runs_policy_state",
  `"status" <> 'succeeded' OR "policy_digest" IS NOT NULL`,
)
@Check(
  "CHK_analysis_query_runs_failure_state",
  `(
    "status" IN ('failed', 'timedOut')
    AND "failure_code" IS NOT NULL
  ) OR (
    "status" NOT IN ('failed', 'timedOut')
    AND "failure_code" IS NULL
  )`,
)
@Check(
  "CHK_analysis_query_runs_terminal_state",
  `(
    "status" = 'cancelled'
    AND "cancelled_at" IS NOT NULL
    AND "succeeded_at" IS NULL
    AND "failed_at" IS NULL
    AND "timed_out_at" IS NULL
  ) OR (
    "status" = 'succeeded'
    AND "cancelled_at" IS NULL
    AND "succeeded_at" IS NOT NULL
    AND "failed_at" IS NULL
    AND "timed_out_at" IS NULL
  ) OR (
    "status" = 'failed'
    AND "cancelled_at" IS NULL
    AND "succeeded_at" IS NULL
    AND "failed_at" IS NOT NULL
    AND "timed_out_at" IS NULL
  ) OR (
    "status" = 'timedOut'
    AND "cancelled_at" IS NULL
    AND "succeeded_at" IS NULL
    AND "failed_at" IS NULL
    AND "timed_out_at" IS NOT NULL
  ) OR (
    "status" IN ('queued', 'running', 'waiting', 'cancelling')
    AND "cancelled_at" IS NULL
    AND "succeeded_at" IS NULL
    AND "failed_at" IS NULL
    AND "timed_out_at" IS NULL
  )`,
)
@Check(
  "CHK_analysis_query_runs_active_state",
  `("status" <> 'running' OR "started_at" IS NOT NULL)
    AND ("status" <> 'waiting' OR ("started_at" IS NOT NULL AND "waiting_at" IS NOT NULL))
    AND ("status" <> 'cancelling' OR "cancelling_at" IS NOT NULL)`,
)
@Check(
  "CHK_analysis_query_runs_timestamps",
  `("started_at" IS NULL OR "started_at" >= "queued_at")
    AND ("waiting_at" IS NULL OR "waiting_at" >= "queued_at")
    AND ("cancelling_at" IS NULL OR "cancelling_at" >= "queued_at")
    AND ("cancelled_at" IS NULL OR "cancelled_at" >= "queued_at")
    AND ("succeeded_at" IS NULL OR "succeeded_at" >= "queued_at")
    AND ("failed_at" IS NULL OR "failed_at" >= "queued_at")
    AND ("timed_out_at" IS NULL OR "timed_out_at" >= "queued_at")
    AND "expires_at" > "queued_at"`,
)
export class AnalysisQueryRun extends WorkspaceOwnedBaseEntity {
  @OneToOne("RuntimeRun", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "id", referencedColumnName: "id" },
  ])
  runtimeRun!: RuntimeRun;

  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof ANALYSIS_QUERY_RUN_SCHEMA_VERSION;

  @Column({ name: "normalized_query", type: "jsonb", update: false })
  normalizedQuery!: AnalysisQueryRunQuery;

  @Column({
    name: "query_digest",
    type: "char",
    length: 64,
    update: false,
  })
  queryDigest!: string;

  @Column({ name: "source_key", type: "varchar", length: 128, update: false })
  sourceKey!: string;

  @Column({
    name: "source_revision",
    type: "varchar",
    length: 128,
    update: false,
  })
  sourceRevision!: string;

  @Column({
    name: "policy_revision",
    type: "varchar",
    length: 128,
    update: false,
  })
  policyRevision!: string;

  @Column({ name: "policy_digest", type: "char", length: 64, nullable: true })
  policyDigest!: string | null;

  @Column({
    name: "requested_by_account_id",
    type: "uuid",
    update: false,
  })
  requestedByAccountId!: string;

  @ManyToOne("Account", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "requested_by_account_id" })
  requestedByAccount!: Account;

  @Column({
    name: "principal_type",
    type: "varchar",
    length: 24,
    update: false,
  })
  principalType!: AnalysisQueryRunPrincipalType;

  @Column({
    name: "integration_token_id",
    type: "uuid",
    nullable: true,
    update: false,
  })
  integrationTokenId!: string | null;

  @ManyToOne("IntegrationToken", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "integration_token_id", referencedColumnName: "id" },
  ])
  integrationToken!: IntegrationToken | null;

  @Column({ name: "request_id", type: "varchar", length: 200, update: false })
  requestId!: string;

  @Column({ type: "varchar", length: 24, default: "queued" })
  status!: AnalysisQueryRunStatus;

  @Column({
    name: "queued_at",
    type: "timestamptz",
    default: () => "CURRENT_TIMESTAMP",
    update: false,
  })
  queuedAt!: Date;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "waiting_at", type: "timestamptz", nullable: true })
  waitingAt!: Date | null;

  @Column({ name: "cancelling_at", type: "timestamptz", nullable: true })
  cancellingAt!: Date | null;

  @Column({ name: "cancelled_at", type: "timestamptz", nullable: true })
  cancelledAt!: Date | null;

  @Column({ name: "succeeded_at", type: "timestamptz", nullable: true })
  succeededAt!: Date | null;

  @Column({ name: "failed_at", type: "timestamptz", nullable: true })
  failedAt!: Date | null;

  @Column({ name: "timed_out_at", type: "timestamptz", nullable: true })
  timedOutAt!: Date | null;

  @Column({ name: "failure_code", type: "varchar", length: 128, nullable: true })
  failureCode!: string | null;

  @Column({ name: "inline_result", type: "jsonb", nullable: true })
  inlineResult!: AnalysisQueryRunInlineResult | null;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;
}
