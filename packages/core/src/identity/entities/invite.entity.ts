import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Role } from "./role.entity.js";
import type { User } from "./user.entity.js";
import { OrganizationBaseEntity } from "./organization-base.entity.js";

/**
 * Invite lifecycle status.
 */
export type InviteStatus = "invited" | "accepted" | "expired" | "revoked";

@Entity({ name: "invites" })
@Index(["organizationId", "email"], { unique: true })
/**
 * Invitation records for onboarding new users into an organization.
 */
export class Invite extends OrganizationBaseEntity {
  /**
   * JWT token used to validate invite acceptance.
   */
  @Column({ type: "varchar", length: 500 })
  @Index({ unique: true })
  token!: string;

  /**
   * Invitee email address.
   */
  @Column({ type: "varchar", length: 240 })
  email!: string;

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
   * User who sent the invitation.
   */
  @Column({ name: "invited_by_id", type: "uuid", nullable: true })
  @Index()
  invitedById!: string | null;

  @ManyToOne("User", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "invited_by_id" })
  invitedBy!: User | null;

  /**
   * Role assigned upon acceptance.
   */
  @Column({ name: "role_id", type: "uuid", nullable: true })
  @Index()
  roleId!: string | null;

  @ManyToOne("Role", { nullable: true, onDelete: "SET NULL" })
  @JoinColumn({ name: "role_id" })
  role!: Role | null;
}
