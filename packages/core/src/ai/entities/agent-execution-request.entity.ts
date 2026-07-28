import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
} from "typeorm";
import type { WorkspaceMembership } from "../../identity/entities/workspace-membership.entity.js";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { RuntimeRun } from "../../runtime/entities/runtime-run.entity.js";
import type { AgentModelReferenceData } from "./agent-entity.types.js";
import type { AgentVersion } from "./agent-version.entity.js";
import type { AiConversation } from "./ai-conversation.entity.js";
import type { AiMessage } from "./ai-message.entity.js";

export const AGENT_EXECUTION_REQUEST_SCHEMA_VERSION =
  "hermes.agent-execution-request/v1" as const;

export type AgentExecutionInput = {
  content: string;
  fileObjectIds: string[];
};
export type AgentExecutionHistoryItem = {
  content: string | null;
  fileObjectIds: string[];
  messageId: string;
  role: "assistant" | "user";
  sequence: number;
};
export type AgentExecutionModelReferenceIntent = {
  binding: Record<string, unknown>;
  declaredReferences: AgentModelReferenceData[];
  modelNodeId: string;
};

@Entity({ name: "agent_execution_requests" })
@Index("UQ_agent_execution_requests_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index("UQ_agent_execution_requests_workspace_owner_client_request", [
  "workspaceId",
  "ownerAccountId",
  "clientRequestId",
], { unique: true })
@Index("UQ_agent_execution_requests_workspace_assistant", [
  "workspaceId",
  "assistantMessageId",
], { unique: true })
@Index("IDX_agent_execution_requests_owner_created", [
  "workspaceId",
  "ownerAccountId",
  "createdAt",
])
@Check(
  "CHK_agent_execution_requests_schema_version",
  `"schema_version" = '${AGENT_EXECUTION_REQUEST_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_agent_execution_requests_request_digest",
  `"request_digest" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_agent_execution_requests_graph_digest",
  `"graph_content_digest" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_agent_execution_requests_json_shapes",
  `jsonb_typeof("input") = 'object'
    AND jsonb_typeof("history_snapshot") = 'array'
    AND jsonb_typeof("model_reference_intent") = 'object'
    AND jsonb_typeof("resolved_model_reference") = 'object'`,
)
@Check(
  "CHK_agent_execution_requests_output_node",
  `"output_node_id" ~ '^[A-Za-z][A-Za-z0-9._:-]*$'`,
)
export class AgentExecutionRequest extends WorkspaceOwnedBaseEntity {
  @OneToOne("RuntimeRun", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "id", referencedColumnName: "id" },
  ])
  runtimeRun!: RuntimeRun;

  @Column({
    name: "schema_version",
    type: "varchar",
    length: 64,
    default: AGENT_EXECUTION_REQUEST_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof AGENT_EXECUTION_REQUEST_SCHEMA_VERSION;

  @Column({ name: "owner_account_id", type: "uuid", update: false })
  ownerAccountId!: string;

  @ManyToOne("WorkspaceMembership", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "owner_account_id", referencedColumnName: "accountId" },
  ])
  ownerMembership!: WorkspaceMembership;

  @Column({ name: "session_id", type: "uuid", update: false })
  sessionId!: string;

  @Column({ name: "client_request_id", type: "uuid", update: false })
  clientRequestId!: string;

  @Column({ name: "request_digest", type: "char", length: 64, update: false })
  requestDigest!: string;

  @Column({ name: "conversation_id", type: "uuid", update: false })
  conversationId!: string;

  @ManyToOne("AiConversation", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "owner_account_id", referencedColumnName: "ownerAccountId" },
    { name: "conversation_id", referencedColumnName: "id" },
  ])
  conversation!: AiConversation;

  @Column({ name: "user_message_id", type: "uuid", update: false })
  userMessageId!: string;

  @ManyToOne("AiMessage", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "conversation_id", referencedColumnName: "conversationId" },
    { name: "user_message_id", referencedColumnName: "id" },
  ])
  userMessage!: AiMessage;

  @Column({ name: "assistant_message_id", type: "uuid", update: false })
  assistantMessageId!: string;

  @ManyToOne("AiMessage", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "conversation_id", referencedColumnName: "conversationId" },
    { name: "assistant_message_id", referencedColumnName: "id" },
  ])
  assistantMessage!: AiMessage;

  @Column({ name: "agent_version_id", type: "uuid", update: false })
  agentVersionId!: string;

  @ManyToOne("AgentVersion", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "agent_version_id", referencedColumnName: "id" },
  ])
  agentVersion!: AgentVersion;

  @Column({ name: "graph_content_digest", type: "char", length: 64, update: false })
  graphContentDigest!: string;

  @Column({ type: "jsonb", update: false })
  input!: AgentExecutionInput;

  @Column({ name: "history_snapshot", type: "jsonb", update: false })
  historySnapshot!: AgentExecutionHistoryItem[];

  @Column({ name: "model_reference_intent", type: "jsonb", update: false })
  modelReferenceIntent!: AgentExecutionModelReferenceIntent;

  @Column({ name: "resolved_model_reference", type: "jsonb", update: false })
  resolvedModelReference!: AgentModelReferenceData;

  @Column({ name: "output_node_id", type: "varchar", length: 128, update: false })
  outputNodeId!: string;
}
