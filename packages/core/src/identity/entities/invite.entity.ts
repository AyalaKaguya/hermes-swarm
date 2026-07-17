import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { User } from "./user.entity.js";
import type { Role } from "./role.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

/**
 * Invite lifecycle status.
 */
export type InviteStatus =
  | "accepted"
  | "declined"
  | "expired"
  | "invited"
  | "revoked";

@Entity({ name: "invites" })
@Index("UQ_invites_active_tenant_email", ["tenantId", "email"], {
  unique: true,
  where: "status = 'invited' AND email IS NOT NULL",
})
/**
 * Invitation records for onboarding new users into an organization.
 */
export class Invite extends TenantOwnedBaseEntity {
  /**
   * JWT token used to validate invite acceptance.
   */
  @Column({ type: "varchar", length: 500 })
  @Index({ unique: true })
  token!: string;

  /**
   * Invitee email address. Null means this is a reusable organization invite
   * link rather than a directed email invite.
   */
  @Column({ type: "varchar", length: 240, nullable: true })
  email!: string | null;

  /**
   * Current lifecycle status.
   */
  @Column({ type: "varchar", length: 24, default: "invited" })
  status!: InviteStatus;

  /**
   * Optional expiry date; null means never expires.
   */
  @Column({ name: "expire_date", type: "timestamptz", nullable: true })
  expireDate!: Date | null;

  /**
   * When the invite was accepted or rejected.
   */
  @Column({ name: "action_date", type: "timestamptz", nullable: true })
  actionDate!: Date | null;

  /**
   * When the invite link was closed by an organization administrator.
   */
  @Column({ name: "closed_at", type: "timestamptz", nullable: true })
  closedAt!: Date | null;

  /**
   * Number of successful joins attributed to this invite link.
   */
  @Column({ name: "accepted_count", type: "integer", default: 0 })
  acceptedCount!: number;

  /**
   * User that accepted this invite most recently.
   */
  @Column({ name: "accepted_user_id", type: "uuid", nullable: true })
  @Index()
  acceptedUserId!: string | null;

  @ManyToOne("User", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "accepted_user_id" })
  acceptedUser!: User | null;

  /**
   * User who sent the invitation.
   */
  @Column({ name: "invited_by_id", type: "uuid", nullable: true })
  @Index()
  invitedById!: string | null;

  @ManyToOne("User", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "invited_by_id" })
  invitedBy!: User | null;

  @Column({ name: "workspace_role_id", type: "uuid" })
  @Index()
  workspaceRoleId!: string;

  @ManyToOne("Role", { onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "tenant_id", referencedColumnName: "tenantId" },
    { name: "workspace_role_id", referencedColumnName: "id" },
  ])
  workspaceRole!: Role;

  @Column({ name: "organization_assignments", type: "jsonb", default: () => "'[]'::jsonb" })
  organizationAssignments!: Array<{
    isDefault?: boolean;
    organizationId: string;
    roleId: string;
  }>;
}
