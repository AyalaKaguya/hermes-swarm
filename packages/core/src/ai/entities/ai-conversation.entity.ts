import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import type { WorkspaceMembership } from "../../identity/entities/workspace-membership.entity.js";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { AgentVersion } from "./agent-version.entity.js";

export const AI_CONVERSATION_SCHEMA_VERSION =
  "hermes.ai-conversation/v1" as const;
export type AiConversationStatus = "active" | "archived";

@Entity({ name: "ai_conversations" })
@Index("UQ_ai_conversations_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index("UQ_ai_conversations_workspace_owner_id", [
  "workspaceId",
  "ownerAccountId",
  "id",
], { unique: true })
@Index("IDX_ai_conversations_owner_updated", [
  "workspaceId",
  "ownerAccountId",
  "updatedAt",
])
@Check(
  "CHK_ai_conversations_schema_version",
  `"schema_version" = '${AI_CONVERSATION_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_ai_conversations_status",
  `"status" IN ('active', 'archived')`,
)
@Check(
  "CHK_ai_conversations_message_sequence",
  `"message_sequence" >= 0`,
)
export class AiConversation extends WorkspaceOwnedBaseEntity {
  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: AI_CONVERSATION_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof AI_CONVERSATION_SCHEMA_VERSION;

  @Column({ name: "owner_account_id", type: "uuid", update: false })
  ownerAccountId!: string;

  @ManyToOne("WorkspaceMembership", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "owner_account_id", referencedColumnName: "accountId" },
  ])
  ownerMembership!: WorkspaceMembership;

  @Column({ name: "agent_version_id", type: "uuid", update: false })
  agentVersionId!: string;

  @ManyToOne("AgentVersion", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "agent_version_id", referencedColumnName: "id" },
  ])
  agentVersion!: AgentVersion;

  @Column({ type: "varchar", length: 240, default: "" })
  title!: string;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: AiConversationStatus;

  @Column({ name: "message_sequence", type: "integer", default: 0 })
  messageSequence!: number;

  @Column({ name: "last_message_at", type: "timestamptz", nullable: true })
  lastMessageAt!: Date | null;
}
