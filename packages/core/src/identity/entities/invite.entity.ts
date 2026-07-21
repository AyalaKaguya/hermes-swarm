import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Account } from "./account.entity.js";
import type { Role } from "./role.entity.js";
import type { Workspace } from "./workspace.entity.js";
import { BaseEntity } from "./base.entity.js";

/**
 * Invite lifecycle status.
 */
export type InviteStatus =
  | "accepted"
  | "declined"
  | "expired"
  | "invited"
  | "revoked";
export type InviteContextType = "platform" | "workspace";

@Entity({ name: "invites" })
@Index("UQ_invites_active_workspace_email", ["workspaceId", "email"], {
  unique: true,
  where: "context_type = 'workspace' AND status = 'invited' AND email IS NOT NULL",
})
@Index("UQ_invites_active_platform_email", ["email"], {
  unique: true,
  where: "context_type = 'platform' AND status = 'invited' AND email IS NOT NULL",
})
@Check(
  "CHK_invites_context_workspace",
  `(context_type = 'platform' AND workspace_id IS NULL) OR (context_type = 'workspace' AND workspace_id IS NOT NULL)`,
)
/**
 * Invitation records for onboarding new users into a workspace.
 */
export class Invite extends BaseEntity {
  @Column({ name: "context_type", type: "varchar", length: 24, default: "workspace" })
  contextType!: InviteContextType;

  @Column({ name: "workspace_id", type: "uuid", nullable: true })
  @Index()
  workspaceId!: string | null;

  @ManyToOne("Workspace", { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "workspace_id" })
  workspace!: Workspace | null;
  /**
   * JWT token used to validate invite acceptance.
   */
  @Column({ type: "varchar", length: 500 })
  @Index({ unique: true })
  token!: string;

  /**
   * Invitee email address. Null means this is a reusable workspace invite
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
   * When the invite link was closed by a workspace administrator.
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

  @ManyToOne("Account", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "accepted_user_id" })
  acceptedUser!: Account | null;

  /**
   * User who sent the invitation.
   */
  @Column({ name: "invited_by_id", type: "uuid", nullable: true })
  @Index()
  invitedById!: string | null;

  @ManyToOne("Account", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "invited_by_id" })
  invitedBy!: Account | null;

  @Column({ name: "role_id", type: "uuid" })
  @Index()
  roleId!: string;

  @ManyToOne("Role", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "role_id" })
  role!: Role;

  /** Workspace invitation compatibility alias; platform invitations use roleId. */
  get workspaceRoleId() {
    return this.roleId;
  }

  set workspaceRoleId(value: string) {
    this.roleId = value;
  }

  get workspaceRole() {
    return this.role;
  }

  set workspaceRole(value: Role) {
    this.role = value;
  }
}
