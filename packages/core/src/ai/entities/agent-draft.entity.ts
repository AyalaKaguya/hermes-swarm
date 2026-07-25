import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  OneToOne,
} from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Agent } from "./agent.entity.js";
import type {
  AgentApiVersion,
  AgentGraphData,
  AgentModelReferenceData,
  AgentToolReferenceData,
} from "./agent-entity.types.js";

@Entity({ name: "agent_drafts" })
@Index("UQ_agent_drafts_workspace_agent", ["workspaceId", "agentId"], {
  unique: true,
})
@Check("CHK_agent_drafts_revision", `"revision" > 0`)
@Check("CHK_agent_drafts_api_version", `"api_version" = 'hermes.ai/v1'`)
@Check(
  "CHK_agent_drafts_json_shapes",
  `jsonb_typeof("graph") = 'object' AND jsonb_typeof("model_references") = 'array' AND jsonb_typeof("tool_references") = 'array'`,
)
export class AgentDraft extends BaseEntity {
  @Column({
    name: "api_version",
    type: "varchar",
    length: 32,
    default: "hermes.ai/v1",
    update: false,
  })
  apiVersion!: AgentApiVersion;

  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @Column({ name: "agent_id", type: "uuid" })
  agentId!: string;

  @OneToOne("Agent", "draft", { nullable: false, onDelete: "CASCADE" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "agent_id", referencedColumnName: "id" },
  ])
  agent!: Agent;

  @Column({ type: "integer", default: 1 })
  revision!: number;

  @Column({ type: "jsonb" })
  graph!: AgentGraphData;

  @Column({ name: "model_references", type: "jsonb" })
  modelReferences!: AgentModelReferenceData[];

  @Column({ name: "tool_references", type: "jsonb" })
  toolReferences!: AgentToolReferenceData[];
}
