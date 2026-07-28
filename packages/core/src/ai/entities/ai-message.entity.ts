import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { RuntimeRun, RuntimeRunStatus } from "../../runtime/entities/runtime-run.entity.js";
import type { AiConversation } from "./ai-conversation.entity.js";

export const AI_MESSAGE_SCHEMA_VERSION = "hermes.ai-message/v1" as const;
export type AiMessageRole = "assistant" | "user";
export type AiMessageStatus = "completed" | RuntimeRunStatus;

@Entity({ name: "ai_messages" })
@Index("UQ_ai_messages_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index("UQ_ai_messages_workspace_conversation_id", [
  "workspaceId",
  "conversationId",
  "id",
], { unique: true })
@Index("UQ_ai_messages_workspace_conversation_sequence", [
  "workspaceId",
  "conversationId",
  "sequence",
], { unique: true })
@Index("UQ_ai_messages_workspace_runtime_run", ["workspaceId", "runtimeRunId"], {
  unique: true,
  where: `"runtime_run_id" IS NOT NULL`,
})
@Index("IDX_ai_messages_conversation_created", [
  "workspaceId",
  "conversationId",
  "createdAt",
])
@Check(
  "CHK_ai_messages_schema_version",
  `"schema_version" = '${AI_MESSAGE_SCHEMA_VERSION}'`,
)
@Check("CHK_ai_messages_sequence", `"sequence" > 0`)
@Check(
  "CHK_ai_messages_role_status",
  `(
    "role" = 'user'
    AND "status" = 'completed'
    AND "content" IS NOT NULL
    AND "runtime_run_id" IS NULL
    AND "reply_to_message_id" IS NULL
    AND "started_at" IS NULL
    AND "finished_at" IS NOT NULL
    AND "failure_code" IS NULL
  ) OR (
    "role" = 'assistant'
    AND "status" IN (
      'cancelled', 'cancelling', 'failed', 'queued',
      'running', 'succeeded', 'timedOut', 'waiting'
    )
    AND "runtime_run_id" IS NOT NULL
    AND "id" = "runtime_run_id"
    AND "reply_to_message_id" IS NOT NULL
  )`,
)
@Check(
  "CHK_ai_messages_assistant_terminal",
  `"role" <> 'assistant' OR (
    (
      "status" IN ('cancelled', 'failed', 'succeeded', 'timedOut')
      AND "finished_at" IS NOT NULL
    ) OR (
      "status" IN ('cancelling', 'queued', 'running', 'waiting')
      AND "finished_at" IS NULL
    )
  )`,
)
@Check(
  "CHK_ai_messages_assistant_content",
  `"role" <> 'assistant' OR (
    ("status" = 'succeeded' AND "content" IS NOT NULL)
    OR ("status" = 'queued' AND "content" IS NULL)
    OR "status" IN ('cancelled', 'cancelling', 'failed', 'running', 'timedOut', 'waiting')
  )`,
)
@Check(
  "CHK_ai_messages_failure",
  `(
    "role" = 'assistant'
    AND "status" IN ('failed', 'timedOut')
    AND "failure_code" IS NOT NULL
  ) OR (
    NOT ("role" = 'assistant' AND "status" IN ('failed', 'timedOut'))
    AND "failure_code" IS NULL
  )`,
)
export class AiMessage extends WorkspaceOwnedBaseEntity {
  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: AI_MESSAGE_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof AI_MESSAGE_SCHEMA_VERSION;

  @Column({ name: "conversation_id", type: "uuid", update: false })
  conversationId!: string;

  @ManyToOne("AiConversation", { nullable: false, onDelete: "CASCADE" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "conversation_id", referencedColumnName: "id" },
  ])
  conversation!: AiConversation;

  @Column({ type: "integer", update: false })
  sequence!: number;

  @Column({ type: "varchar", length: 24, update: false })
  role!: AiMessageRole;

  @Column({ type: "varchar", length: 24 })
  status!: AiMessageStatus;

  @Column({ type: "text", nullable: true })
  content!: string | null;

  @Column({ name: "reply_to_message_id", type: "uuid", nullable: true, update: false })
  replyToMessageId!: string | null;

  @ManyToOne("AiMessage", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "conversation_id", referencedColumnName: "conversationId" },
    { name: "reply_to_message_id", referencedColumnName: "id" },
  ])
  replyToMessage!: AiMessage | null;

  @Column({ name: "runtime_run_id", type: "uuid", nullable: true, update: false })
  runtimeRunId!: string | null;

  @OneToOne("RuntimeRun", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "runtime_run_id", referencedColumnName: "id" },
  ])
  runtimeRun!: RuntimeRun | null;

  @Column({ name: "started_at", type: "timestamptz", nullable: true })
  startedAt!: Date | null;

  @Column({ name: "finished_at", type: "timestamptz", nullable: true })
  finishedAt!: Date | null;

  @Column({ name: "failure_code", type: "varchar", length: 160, nullable: true })
  failureCode!: string | null;
}
