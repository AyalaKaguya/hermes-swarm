import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Workspace } from "../../identity/entities/workspace.entity.js";
import type {
  ModelCapability,
  ModelDeploymentConfig,
  ModelProviderStatus,
} from "./model-provider.types.js";
import type { WorkspaceModelProvider } from "./workspace-model-provider.entity.js";

@Entity({ name: "workspace_model_deployments" })
@Index(
  "UQ_workspace_model_deployments_provider_model",
  ["workspaceId", "providerId", "modelId", "capability"],
  { unique: true },
)
@Index(
  "UQ_workspace_model_deployments_workspace_id_id",
  ["workspaceId", "id"],
  { unique: true },
)
@Index(
  "UQ_workspace_model_deployments_workspace_id_capability",
  ["workspaceId", "id", "capability"],
  { unique: true },
)
@Index(
  "UQ_workspace_model_deployments_provider_name",
  ["workspaceId", "providerId", "name"],
  { unique: true },
)
@Index("IDX_workspace_model_deployments_workspace_status", ["workspaceId", "status"])
export class WorkspaceModelDeployment extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @ManyToOne("Workspace", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace;

  @Column({ name: "provider_id", type: "uuid" })
  providerId!: string;

  @ManyToOne("WorkspaceModelProvider", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "provider_id", referencedColumnName: "id" },
  ])
  provider!: WorkspaceModelProvider;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 32 })
  capability!: ModelCapability;

  @Column({ name: "model_id", type: "varchar", length: 240 })
  modelId!: string;

  @Column({ type: "integer", default: 1 })
  revision!: number;

  @Column({ type: "varchar", length: 24, default: "disabled" })
  status!: ModelProviderStatus;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  config!: ModelDeploymentConfig;
}
