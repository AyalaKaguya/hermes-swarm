import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { Workspace } from "../../identity/entities/workspace.entity.js";
import type {
  ModelProviderConfig,
  ModelProviderDriver,
  ModelProviderStatus,
} from "./model-provider.types.js";

@Entity({ name: "workspace_model_providers" })
@Index("UQ_workspace_model_providers_workspace_name", ["workspaceId", "name"], {
  unique: true,
})
@Index("UQ_workspace_model_providers_workspace_id_id", ["workspaceId", "id"], {
  unique: true,
})
@Index("UQ_workspace_model_providers_secret_id", ["secretId"], {
  unique: true,
})
@Index("IDX_workspace_model_providers_workspace_status", ["workspaceId", "status"])
export class WorkspaceModelProvider extends BaseEntity {
  @Column({ name: "workspace_id", type: "uuid" })
  workspaceId!: string;

  @ManyToOne("Workspace", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 64 })
  driver!: ModelProviderDriver;

  @Column({ name: "base_url", type: "varchar", length: 500 })
  baseUrl!: string;

  @Column({ type: "varchar", length: 24, default: "disabled" })
  status!: ModelProviderStatus;

  @Column({ type: "integer", default: 1 })
  revision!: number;

  @Column({ type: "jsonb", default: () => "'{}'::jsonb" })
  config!: ModelProviderConfig;

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
