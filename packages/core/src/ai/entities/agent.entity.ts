import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  OneToOne,
} from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Workspace } from "../../identity/entities/workspace.entity.js";
import type { AgentDraft } from "./agent-draft.entity.js";
import type { AgentStatus } from "./agent-entity.types.js";
import type { AgentVersion } from "./agent-version.entity.js";

@Entity({ name: "agents" })
@Index("UQ_agents_workspace_name", ["workspaceId", "name"], { unique: true })
@Index("UQ_agents_workspace_id_id", ["workspaceId", "id"], { unique: true })
@Index("IDX_agents_workspace_status", ["workspaceId", "status"])
@Check("CHK_agents_revision", `"revision" > 0`)
@Check("CHK_agents_latest_version", `"latest_version" >= 0`)
@Check("CHK_agents_status", `"status" IN ('active', 'archived')`)
export class Agent extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @ManyToOne("Workspace", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 2_000, default: "" })
  description!: string;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: AgentStatus;

  @Column({ type: "integer", default: 1 })
  revision!: number;

  /** Serialized publication counter; changed only inside the publish transaction. */
  @Column({ name: "latest_version", type: "integer", default: 0 })
  latestVersion!: number;

  @OneToOne("AgentDraft", "agent")
  draft!: AgentDraft;

  @OneToMany("AgentVersion", "agent")
  versions!: AgentVersion[];
}
