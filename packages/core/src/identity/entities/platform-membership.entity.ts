import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Account } from "./account.entity.js";
import type { Role } from "./role.entity.js";
import { BaseEntity } from "./base.entity.js";

export type PlatformMembershipStatus = "active" | "disabled" | "removed";

@Entity({ name: "platform_memberships" })
@Index("UQ_platform_memberships_account", ["accountId"], { unique: true })
@Check(
  "CHK_platform_membership_role_status",
  `(status = 'removed' AND role_id IS NULL) OR (status IN ('active', 'disabled') AND role_id IS NOT NULL)`,
)
export class PlatformMembership extends BaseEntity {
  @Column({ name: "account_id", type: "uuid" })
  @Index()
  accountId!: string;

  @ManyToOne("Account", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "account_id" })
  account!: Account;

  @Column({ name: "role_id", type: "uuid", nullable: true })
  @Index()
  roleId!: string | null;

  @ManyToOne("Role", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "role_id" })
  role!: Role | null;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: PlatformMembershipStatus;

  @Column({ name: "removed_at", type: "timestamptz", nullable: true })
  removedAt!: Date | null;
}
