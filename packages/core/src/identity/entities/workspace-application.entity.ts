import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Account } from "./account.entity.js";
import type { Workspace } from "./workspace.entity.js";
import { BaseEntity } from "./base.entity.js";

export type WorkspaceApplicationStatus =
  | "pending_email_verification"
  | "pending_review"
  | "approved"
  | "rejected"
  | "cancelled";

@Entity({ name: "workspace_applications" })
@Index("UQ_workspace_applications_active_slug", ["requestedSlug"], {
  unique: true,
  where: "status IN ('pending_email_verification', 'pending_review', 'approved')",
})
export class WorkspaceApplication extends BaseEntity {
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

  @Column({ name: "preferred_language", type: "varchar", length: 16, default: "zh-Hans" })
  preferredLanguage!: "en" | "zh-Hans" | "zh-Hant";

  @Column({ name: "email_verification_token_hash", type: "varchar", length: 240, nullable: true })
  emailVerificationTokenHash!: string | null;

  @Column({ name: "cancellation_token_hash", type: "varchar", length: 240, nullable: true })
  cancellationTokenHash!: string | null;

  @Column({ name: "email_verified_at", type: "timestamptz", nullable: true })
  emailVerifiedAt!: Date | null;

  @Column({ type: "varchar", length: 40, default: "pending_email_verification" })
  status!: WorkspaceApplicationStatus;

  @Column({ name: "reviewed_by_account_id", type: "uuid", nullable: true })
  reviewedByAccountId!: string | null;

  @ManyToOne("Account", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "reviewed_by_account_id" })
  reviewedByAccount!: Account | null;

  @Column({ name: "reviewed_at", type: "timestamptz", nullable: true })
  reviewedAt!: Date | null;

  @Column({ name: "review_note", type: "text", nullable: true })
  reviewNote!: string | null;

  @Column({ name: "workspace_id", type: "uuid", nullable: true })
  workspaceId!: string | null;

  @ManyToOne("Workspace", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace | null;
}
