import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import type { FileObject } from "../../files/entities/file-object.entity.js";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { AgentExecutionRequest } from "./agent-execution-request.entity.js";
import type { AiConversation } from "./ai-conversation.entity.js";
import type { AiMessage } from "./ai-message.entity.js";

export const AI_ARTIFACT_SCHEMA_VERSION = "hermes.ai-artifact/v1" as const;
export type AiArtifactType = "chart" | "file" | "json" | "table" | "text";
export type AiArtifactStatus = "failed" | "pending" | "ready";

@Entity({ name: "ai_artifacts" })
@Index("UQ_ai_artifacts_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index("UQ_ai_artifacts_workspace_execution_ordinal", [
  "workspaceId",
  "executionRequestId",
  "ordinal",
], { unique: true })
@Index("UQ_ai_artifacts_workspace_file", ["workspaceId", "fileObjectId"], {
  unique: true,
  where: `"file_object_id" IS NOT NULL`,
})
@Index("IDX_ai_artifacts_message_created", [
  "workspaceId",
  "messageId",
  "createdAt",
])
@Check(
  "CHK_ai_artifacts_schema_version",
  `"schema_version" = '${AI_ARTIFACT_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_ai_artifacts_type",
  `"type" IN ('chart', 'file', 'json', 'table', 'text')`,
)
@Check(
  "CHK_ai_artifacts_status",
  `"status" IN ('failed', 'pending', 'ready')`,
)
@Check("CHK_ai_artifacts_ordinal", `"ordinal" >= 0`)
@Check(
  "CHK_ai_artifacts_lifecycle",
  `(
    "status" = 'pending'
    AND "inline_payload" IS NULL
    AND "ready_at" IS NULL
    AND "failed_at" IS NULL
    AND "failure_code" IS NULL
  ) OR (
    "status" = 'ready'
    AND (("inline_payload" IS NULL) <> ("file_object_id" IS NULL))
    AND "ready_at" IS NOT NULL
    AND "failed_at" IS NULL
    AND "failure_code" IS NULL
  ) OR (
    "status" = 'failed'
    AND "ready_at" IS NULL
    AND "failed_at" IS NOT NULL
    AND "failure_code" IS NOT NULL
  )`,
)
export class AiArtifact extends WorkspaceOwnedBaseEntity {
  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: AI_ARTIFACT_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof AI_ARTIFACT_SCHEMA_VERSION;

  @Column({ name: "conversation_id", type: "uuid", update: false })
  conversationId!: string;

  @ManyToOne("AiConversation", { nullable: false, onDelete: "CASCADE" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "conversation_id", referencedColumnName: "id" },
  ])
  conversation!: AiConversation;

  @Column({ name: "message_id", type: "uuid", update: false })
  messageId!: string;

  @ManyToOne("AiMessage", { nullable: false, onDelete: "CASCADE" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "conversation_id", referencedColumnName: "conversationId" },
    { name: "message_id", referencedColumnName: "id" },
  ])
  message!: AiMessage;

  @Column({ name: "execution_request_id", type: "uuid", update: false })
  executionRequestId!: string;

  @ManyToOne("AgentExecutionRequest", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "execution_request_id", referencedColumnName: "id" },
  ])
  executionRequest!: AgentExecutionRequest;

  @Column({ type: "smallint", update: false })
  ordinal!: number;

  @Column({ type: "varchar", length: 24, update: false })
  type!: AiArtifactType;

  @Column({ type: "varchar", length: 24, default: "pending" })
  status!: AiArtifactStatus;

  @Column({ type: "varchar", length: 500 })
  title!: string;

  @Column({ name: "inline_payload", type: "jsonb", nullable: true })
  inlinePayload!: unknown | null;

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

  @Column({ name: "failure_code", type: "varchar", length: 160, nullable: true })
  failureCode!: string | null;
}
