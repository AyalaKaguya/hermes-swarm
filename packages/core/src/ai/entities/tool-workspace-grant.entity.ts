import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Workspace } from "../../identity/entities/workspace.entity.js";
import type { ToolDefinitionVersion } from "./tool-definition-version.entity.js";
import type { WorkspaceToolConnection } from "./tool-workspace-connection.entity.js";

@Entity({ name: "workspace_tool_grants" })
@Index(
  "UQ_workspace_tool_grants_workspace_tool_version",
  ["workspaceId", "toolDefinitionId", "toolVersion"],
  { unique: true },
)
@Index("IDX_workspace_tool_grants_workspace_enabled", [
  "workspaceId",
  "enabled",
])
@Index("IDX_workspace_tool_grants_definition", [
  "toolDefinitionId",
  "toolVersion",
  "workspaceId",
])
@Check("CHK_workspace_tool_grants_revision", `"revision" > 0`)
export class WorkspaceToolGrant extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @ManyToOne("Workspace", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace;

  @Column({ name: "tool_definition_id", type: "uuid" })
  toolDefinitionId!: string;

  @Column({ name: "tool_version", type: "varchar", length: 64 })
  toolVersion!: string;

  @ManyToOne("ToolDefinitionVersion", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn([
    {
      name: "tool_definition_id",
      referencedColumnName: "toolDefinitionId",
    },
    { name: "tool_version", referencedColumnName: "version" },
  ])
  toolDefinitionVersion!: ToolDefinitionVersion;

  @Column({ name: "connection_id", type: "uuid", nullable: true })
  connectionId!: string | null;

  @ManyToOne("WorkspaceToolConnection", {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn([
    { name: "connection_id", referencedColumnName: "id" },
    { name: "workspace_id", referencedColumnName: "workspaceId" },
  ])
  connection!: WorkspaceToolConnection | null;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;

  @Column({ type: "integer", default: 1 })
  revision!: number;
}
