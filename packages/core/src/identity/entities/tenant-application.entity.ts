import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { PlatformUser } from "./platform-user.entity.js";
import type { Tenant } from "./tenant.entity.js";
import { BaseEntity } from "./base.entity.js";

export type TenantApplicationStatus =
  | "pending_email_verification"
  | "pending_review"
  | "approved"
  | "rejected"
  | "cancelled";

@Entity({ name: "tenant_applications" })
@Index("UQ_tenant_applications_active_slug", ["requestedSlug"], {
  unique: true,
  where: "status IN ('pending_email_verification', 'pending_review', 'approved')",
})
export class TenantApplication extends BaseEntity {
  @Column({ name: "requested_name", type: "varchar", length: 120 })
  requestedName!: string;

  @Column({ name: "requested_slug", type: "varchar", length: 80 })
  requestedSlug!: string;

  @Column({ name: "requested_subdomain", type: "varchar", length: 80, nullable: true })
  requestedSubdomain!: string | null;

  @Column({ name: "owner_email", type: "varchar", length: 160 })
  @Index()
  ownerEmail!: string;

  @Column({ name: "owner_display_name", type: "varchar", length: 120 })
  ownerDisplayName!: string;

  @Column({ name: "preferred_language", type: "varchar", length: 16, default: "zh-CN" })
  preferredLanguage!: "en" | "zh-CN";

  @Column({ name: "email_verification_token_hash", type: "varchar", length: 240, nullable: true })
  emailVerificationTokenHash!: string | null;

  @Column({ name: "cancellation_token_hash", type: "varchar", length: 240, nullable: true })
  cancellationTokenHash!: string | null;

  @Column({ name: "email_verified_at", type: "timestamptz", nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: "varchar", length: 40, default: "pending_email_verification" })
  status!: TenantApplicationStatus;

  @Column({ name: "reviewed_by_platform_user_id", type: "uuid", nullable: true })
  reviewedByPlatformUserId!: string | null;

  @ManyToOne("PlatformUser", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "reviewed_by_platform_user_id" })
  reviewedByPlatformUser!: PlatformUser | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: "review_note", type: "text", nullable: true })
  reviewNote!: string | null;

  @Column({ name: "tenant_id", type: "uuid", nullable: true })
  tenantId!: string | null;

  @ManyToOne("Tenant", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant | null;
}
