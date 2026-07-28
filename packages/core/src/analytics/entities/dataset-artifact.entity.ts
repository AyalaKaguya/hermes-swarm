import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from "typeorm";
import type { FileObject } from "../../files/entities/file-object.entity.js";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { AnalysisQueryRun } from "./analysis-query-run.entity.js";

export const DATASET_ARTIFACT_MAX_PREVIEW_ROWS = 100;
export const DATASET_ARTIFACT_MAX_PREVIEW_BYTES = 256 * 1024;
export const DATASET_ARTIFACT_SCHEMA_VERSION =
  "hermes.analytics.dataset-artifact/v1" as const;

export type DatasetArtifactStatus =
  | "expired"
  | "failed"
  | "pending"
  | "ready";
export type DatasetArtifactLineage = Record<string, unknown>;
export type DatasetArtifactResultField = Record<string, unknown>;
export type DatasetArtifactPreviewRow = Record<string, unknown>;

@Entity({ name: "dataset_artifacts" })
@Index("UQ_dataset_artifacts_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index(
  "UQ_dataset_artifacts_workspace_query_run",
  ["workspaceId", "queryRunId"],
  { unique: true },
)
@Index(
  "UQ_dataset_artifacts_workspace_file_object",
  ["workspaceId", "fileObjectId"],
  { unique: true, where: `"file_object_id" IS NOT NULL` },
)
@Index("IDX_dataset_artifacts_workspace_status_created", [
  "workspaceId",
  "status",
  "createdAt",
])
@Index("IDX_dataset_artifacts_expiration", ["expiresAt", "id"], {
  where: `"status" IN ('failed', 'pending', 'ready')`,
})
@Check(
  "CHK_dataset_artifacts_schema_version",
  `"schema_version" = '${DATASET_ARTIFACT_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_dataset_artifacts_status",
  `"status" IN ('expired', 'failed', 'pending', 'ready')`,
)
@Check(
  "CHK_dataset_artifacts_lineage",
  `"lineage" IS NULL OR (
    jsonb_typeof("lineage") = 'object'
    AND "lineage" ?& ARRAY['generatedAt', 'policyDigest', 'queryDigest', 'sourceKey', 'sourceRevision']
    AND jsonb_typeof("lineage"->'generatedAt') = 'string'
    AND jsonb_typeof("lineage"->'policyDigest') = 'string'
    AND ("lineage"->>'policyDigest') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("lineage"->'queryDigest') = 'string'
    AND ("lineage"->>'queryDigest') ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof("lineage"->'sourceKey') = 'string'
    AND jsonb_typeof("lineage"->'sourceRevision') = 'string'
  )`,
)
@Check(
  "CHK_dataset_artifacts_result_schema",
  `"result_schema" IS NULL OR (
    jsonb_typeof("result_schema") = 'array'
    AND jsonb_array_length("result_schema") > 0
  )`,
)
@Check(
  "CHK_dataset_artifacts_preview",
  `"preview" IS NULL OR (
    jsonb_typeof("preview") = 'array'
    AND jsonb_array_length("preview") <= ${DATASET_ARTIFACT_MAX_PREVIEW_ROWS}
    AND pg_column_size("preview") <= ${DATASET_ARTIFACT_MAX_PREVIEW_BYTES}
  )`,
)
@Check(
  "CHK_dataset_artifacts_counts",
  `("row_count" IS NULL OR "row_count" >= 0)
    AND ("byte_size" IS NULL OR "byte_size" >= 0)
    AND ("preview" IS NULL OR "row_count" IS NULL OR jsonb_array_length("preview") <= "row_count")`,
)
@Check(
  "CHK_dataset_artifacts_sha256",
  `"sha256" IS NULL OR "sha256" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_dataset_artifacts_ready_state",
  `(
    "status" = 'ready'
    AND "file_object_id" IS NOT NULL
    AND "lineage" IS NOT NULL
    AND "result_schema" IS NOT NULL
    AND "preview" IS NOT NULL
    AND "row_count" IS NOT NULL
    AND "byte_size" IS NOT NULL
    AND "sha256" IS NOT NULL
    AND "ready_at" IS NOT NULL
    AND "failed_at" IS NULL
    AND "failure_code" IS NULL
  ) OR (
    "status" = 'expired'
    AND "file_object_id" IS NULL
    AND "lineage" IS NOT NULL
    AND "result_schema" IS NOT NULL
    AND "preview" IS NULL
    AND "row_count" IS NOT NULL
    AND "byte_size" IS NOT NULL
    AND "sha256" IS NOT NULL
    AND "ready_at" IS NOT NULL
    AND "failed_at" IS NULL
    AND "failure_code" IS NULL
  ) OR (
    "status" = 'pending'
    AND "ready_at" IS NULL
    AND "failed_at" IS NULL
    AND "failure_code" IS NULL
  ) OR (
    "status" = 'failed'
    AND "ready_at" IS NULL
    AND "failed_at" IS NOT NULL
    AND "failure_code" IS NOT NULL
  )`,
)
@Check(
  "CHK_dataset_artifacts_timestamps",
  `("ready_at" IS NULL OR "ready_at" >= "created_at")
    AND ("failed_at" IS NULL OR "failed_at" >= "created_at")
    AND "expires_at" > "created_at"`,
)
export class DatasetArtifact extends WorkspaceOwnedBaseEntity {
  @Column({ name: "query_run_id", type: "uuid", update: false })
  queryRunId!: string;

  @OneToOne("AnalysisQueryRun", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "query_run_id", referencedColumnName: "id" },
  ])
  queryRun!: AnalysisQueryRun;

  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: DATASET_ARTIFACT_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof DATASET_ARTIFACT_SCHEMA_VERSION;

  @Column({ type: "varchar", length: 24, default: "pending" })
  status!: DatasetArtifactStatus;

  @Column({ type: "jsonb", nullable: true })
  lineage!: DatasetArtifactLineage | null;

  @Column({ name: "result_schema", type: "jsonb", nullable: true })
  resultSchema!: DatasetArtifactResultField[] | null;

  @Column({ type: "jsonb", nullable: true })
  preview!: DatasetArtifactPreviewRow[] | null;

  @Column({ name: "row_count", type: "integer", nullable: true })
  rowCount!: number | null;

  @Column({ name: "byte_size", type: "integer", nullable: true })
  byteSize!: number | null;

  @Column({ type: "char", length: 64, nullable: true })
  sha256!: string | null;

  @Column({ name: "file_object_id", type: "uuid", nullable: true })
  fileObjectId!: string | null;

  @ManyToOne("FileObject", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "file_object_id", referencedColumnName: "id" },
  ])
  fileObject!: FileObject | null;

  @Column({ name: "ready_at", type: "timestamptz", nullable: true })
  readyAt!: Date | null;

  @Column({ name: "failed_at", type: "timestamptz", nullable: true })
  failedAt!: Date | null;

  @Column({ name: "failure_code", type: "varchar", length: 128, nullable: true })
  failureCode!: string | null;

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;
}
