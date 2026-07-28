import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Workspace } from "../../identity/entities/workspace.entity.js";
import type { PlatformModelDeployment } from "./platform-model-deployment.entity.js";

@Entity({ name: "workspace_model_grants" })
@Index(
  "UQ_workspace_model_grants_workspace_deployment",
  ["workspaceId", "platformDeploymentId"],
  { unique: true },
)
@Index("IDX_workspace_model_grants_deployment", ["platformDeploymentId", "workspaceId"])
export class WorkspaceModelGrant extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @ManyToOne("Workspace", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace;

  @Column({ name: "platform_deployment_id", type: "uuid" })
  platformDeploymentId!: string;

  @ManyToOne("PlatformModelDeployment", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "platform_deployment_id" })
  platformDeployment!: PlatformModelDeployment;

  @Column({ type: "boolean", default: true })
  enabled!: boolean;

  @Column({ type: "integer", default: 1 })
  revision!: number;

  @Column({ name: "expires_at", type: "timestamptz", nullable: true })
  expiresAt!: Date | null;
}
