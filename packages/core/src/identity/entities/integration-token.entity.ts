import { Column, Entity, Index } from "typeorm";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

export type IntegrationTokenScope = "tenant";

@Entity({ name: "integration_tokens" })
@Index("IDX_integration_tokens_owner", ["ownerUserId"])
@Index("IDX_integration_tokens_hash", ["tokenHash"], { unique: true })
export class IntegrationToken extends TenantOwnedBaseEntity {
  @Column({ name: "owner_user_id", type: "uuid" })
  ownerUserId!: string;

  @Column({ type: "varchar", length: 24 })
  scope!: IntegrationTokenScope;

  @Column({ type: "varchar", length: 160, nullable: true })
  note!: string | null;

  @Column({ name: "token_hash", type: "varchar", length: 64 })
  tokenHash!: string;

  @Column({ name: "token_prefix", type: "varchar", length: 32 })
  tokenPrefix!: string;

  @Column({ type: "jsonb", default: () => "'[]'::jsonb" })
  permissions!: string[];

  @Column({ name: "expires_at", type: "timestamptz" })
  expiresAt!: Date;

  @Column({ name: "last_used_at", type: "timestamptz", nullable: true })
  lastUsedAt!: Date | null;

  @Column({ name: "revoked_at", type: "timestamptz", nullable: true })
  revokedAt!: Date | null;

  @Column({ name: "revoked_reason", type: "varchar", length: 80, nullable: true })
  revokedReason!: string | null;
}
