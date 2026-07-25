import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type {
  ModelProviderConfig,
  ModelProviderDriver,
  ModelProviderStatus,
} from "./model-provider.types.js";

@Entity({ name: "platform_model_providers" })
@Index("UQ_platform_model_providers_name", ["name"], { unique: true })
@Index("UQ_platform_model_providers_secret_id", ["secretId"], {
  unique: true,
})
export class PlatformModelProvider extends BaseEntity {
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
