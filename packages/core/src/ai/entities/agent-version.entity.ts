import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Agent } from "./agent.entity.js";
import type {
  AgentApiVersion,
  AgentGraphData,
  AgentModelReferenceData,
  AgentToolReferenceData,
} from "./agent-entity.types.js";

@Entity({ name: "agent_versions" })
@Index(
  "UQ_agent_versions_workspace_agent_version",
  ["workspaceId", "agentId", "version"],
  { unique: true },
)
@Index(
  "UQ_agent_versions_workspace_agent_draft_revision",
  ["workspaceId", "agentId", "draftRevision"],
  { unique: true },
)
@Index("IDX_agent_versions_agent_published", ["workspaceId", "agentId", "createdAt"])
@Check("CHK_agent_versions_version", `"version" > 0`)
@Check("CHK_agent_versions_api_version", `"api_version" = 'hermes.ai/v1'`)
@Check("CHK_agent_versions_draft_revision", `"draft_revision" > 0`)
@Check(
  "CHK_agent_versions_digest",
  `"content_digest" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_agent_versions_json_shapes",
  `jsonb_typeof("graph") = 'object' AND jsonb_typeof("model_references") = 'array' AND jsonb_typeof("tool_references") = 'array'`,
)
export class AgentVersion extends BaseEntity {
  @Column({ name: "api_version", type: "varchar", length: 32, update: false })
  apiVersion!: AgentApiVersion;

  @Column({ name: "workspace_id", type: "uuid", update: false })
  workspaceId!: string;

  @Column({ name: "agent_id", type: "uuid", update: false })
  agentId!: string;

  @ManyToOne("Agent", "versions", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "agent_id", referencedColumnName: "id" },
  ])
  agent!: Agent;

  @Column({ type: "integer", update: false })
  version!: number;

  @Column({ name: "draft_revision", type: "integer", update: false })
  draftRevision!: number;

  @Column({ name: "content_digest", type: "char", length: 64, update: false })
  contentDigest!: string;

  @Column({ type: "jsonb", update: false })
  graph!: AgentGraphData;

  @Column({ name: "model_references", type: "jsonb", update: false })
  modelReferences!: AgentModelReferenceData[];

  @Column({ name: "tool_references", type: "jsonb", update: false })
  toolReferences!: AgentToolReferenceData[];
}
