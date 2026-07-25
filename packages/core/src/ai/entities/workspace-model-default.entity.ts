import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Workspace } from "../../identity/entities/workspace.entity.js";
import type { ModelCapability } from "./model-provider.types.js";
import type { PlatformModelDeployment } from "./platform-model-deployment.entity.js";
import type { WorkspaceModelDeployment } from "./workspace-model-deployment.entity.js";
import type { WorkspaceModelGrant } from "./workspace-model-grant.entity.js";

@Entity({ name: "workspace_model_defaults" })
@Index("UQ_workspace_model_defaults_workspace_capability", ["workspaceId", "capability"], {
  unique: true,
})
@Index("IDX_workspace_model_defaults_platform_deployment", ["platformDeploymentId"], {
  where: "platform_deployment_id IS NOT NULL",
})
@Index(
  "IDX_workspace_model_defaults_workspace_deployment",
  ["workspaceId", "workspaceDeploymentId"],
  { where: "workspace_deployment_id IS NOT NULL" },
)
export class WorkspaceModelDefault extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @ManyToOne("Workspace", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace;

  @Column({ type: "varchar", length: 32 })
  capability!: ModelCapability;

  /** Exactly one deployment ID is required; the migration owns the XOR check. */
  @Column({ name: "platform_deployment_id", type: "uuid", nullable: true })
  platformDeploymentId!: string | null;

  @ManyToOne("PlatformModelDeployment", {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn([
    { name: "platform_deployment_id", referencedColumnName: "id" },
    { name: "capability", referencedColumnName: "capability" },
  ])
  platformDeployment!: PlatformModelDeployment | null;

  @ManyToOne("WorkspaceModelGrant", {
    nullable: true,
    onDelete: "CASCADE",
    persistence: false,
  })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    {
      name: "platform_deployment_id",
      referencedColumnName: "platformDeploymentId",
    },
  ])
  platformGrant!: WorkspaceModelGrant | null;

  @Column({ name: "workspace_deployment_id", type: "uuid", nullable: true })
  workspaceDeploymentId!: string | null;

  @ManyToOne("WorkspaceModelDeployment", {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "workspace_deployment_id", referencedColumnName: "id" },
    { name: "capability", referencedColumnName: "capability" },
  ])
  workspaceDeployment!: WorkspaceModelDeployment | null;
}
