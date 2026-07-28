import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Workspace } from "../../identity/entities/workspace.entity.js";
import type {
  ExternalToolDriverType,
  ToolCatalogStatus,
  ToolConnectionAuthType,
} from "./tool-entity.types.js";
import type { ToolNetworkPolicy } from "./tool-network-policy.entity.js";

@Entity({ name: "workspace_tool_connections" })
@Index(
  "UQ_workspace_tool_connections_id_workspace_id",
  ["id", "workspaceId"],
  { unique: true },
)
@Index(
  "UQ_workspace_tool_connections_workspace_name",
  ["workspaceId", "name"],
  { unique: true },
)
@Index("UQ_workspace_tool_connections_secret_id", ["secretId"], {
  unique: true,
})
@Index("IDX_workspace_tool_connections_workspace_status", [
  "workspaceId",
  "status",
])
@Index("IDX_workspace_tool_connections_workspace_policy", [
  "workspaceId",
  "networkPolicyId",
])
@Check(
  "CHK_workspace_tool_connections_driver",
  `"driver_type" IN ('http', 'mcpStreamableHttp')`,
)
@Check(
  "CHK_workspace_tool_connections_auth",
  `"auth_type" IN ('none', 'bearer', 'header')`,
)
@Check(
  "CHK_workspace_tool_connections_header",
  `("auth_type" = 'header' AND "auth_header_name" IS NOT NULL) OR ("auth_type" <> 'header' AND "auth_header_name" IS NULL)`,
)
@Check(
  "CHK_workspace_tool_connections_status",
  `"status" IN ('enabled', 'disabled')`,
)
@Check("CHK_workspace_tool_connections_revision", `"revision" > 0`)
@Check(
  "CHK_workspace_tool_connections_secret_state",
  `("secret_id" IS NULL AND "secret_envelope" IS NULL AND "secret_updated_at" IS NULL AND "secret_revision" = 0) OR ("secret_id" IS NOT NULL AND "secret_envelope" IS NOT NULL AND "secret_updated_at" IS NOT NULL AND "secret_revision" > 0)`,
)
@Check(
  "CHK_workspace_tool_connections_enabled_secret",
  `"status" = 'disabled' OR "auth_type" = 'none' OR "secret_id" IS NOT NULL`,
)
@Check(
  "CHK_workspace_tool_connections_none_has_no_secret",
  `"auth_type" <> 'none' OR "secret_id" IS NULL`,
)
export class WorkspaceToolConnection extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @ManyToOne("Workspace", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace;

  @Column({ name: "network_policy_id", type: "uuid" })
  networkPolicyId!: string;

  @ManyToOne("ToolNetworkPolicy", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "network_policy_id" })
  networkPolicy!: ToolNetworkPolicy;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ name: "driver_type", type: "varchar", length: 32 })
  driverType!: ExternalToolDriverType;

  @Column({ name: "base_url", type: "varchar", length: 500 })
  baseUrl!: string;

  @Column({ name: "auth_type", type: "varchar", length: 24, default: "none" })
  authType!: ToolConnectionAuthType;

  @Column({
    name: "auth_header_name",
    type: "varchar",
    length: 120,
    nullable: true,
  })
  authHeaderName!: string | null;

  @Column({ type: "varchar", length: 24, default: "disabled" })
  status!: ToolCatalogStatus;

  @Column({ type: "integer", default: 1 })
  revision!: number;

  @Column({ name: "secret_id", type: "uuid", nullable: true })
  secretId!: string | null;

  @Column({
    name: "secret_envelope",
    type: "text",
    nullable: true,
    select: false,
  })
  secretEnvelope!: string | null;

  @Column({ name: "secret_revision", type: "integer", default: 0 })
  secretRevision!: number;

  @Column({ name: "secret_updated_at", type: "timestamptz", nullable: true })
  secretUpdatedAt!: Date | null;
}
