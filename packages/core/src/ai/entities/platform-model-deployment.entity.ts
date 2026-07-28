import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type {
  ModelCapability,
  ModelDeploymentConfig,
  ModelProviderStatus,
} from "./model-provider.types.js";
import type { PlatformModelProvider } from "./platform-model-provider.entity.js";

@Entity({ name: "platform_model_deployments" })
@Index(
  "UQ_platform_model_deployments_provider_model",
  ["providerId", "modelId", "capability"],
  { unique: true },
)
@Index("UQ_platform_model_deployments_id_capability", ["id", "capability"], {
  unique: true,
})
@Index("UQ_platform_model_deployments_provider_name", ["providerId", "name"], {
  unique: true,
})
@Index("IDX_platform_model_deployments_provider_status", ["providerId", "status"])
export class PlatformModelDeployment extends BaseEntity {
  @Column({ name: "provider_id", type: "uuid" })
  providerId!: string;

  @ManyToOne("PlatformModelProvider", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "provider_id" })
  provider!: PlatformModelProvider;

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
