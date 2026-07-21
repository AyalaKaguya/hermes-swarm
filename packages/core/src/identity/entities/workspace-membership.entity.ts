import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Account } from "./account.entity.js";
import type { Role } from "./role.entity.js";
import { WorkspaceOwnedBaseEntity } from "./workspace-owned-base.entity.js";

export type WorkspaceMembershipStatus = "active" | "disabled" | "removed";

@Entity({ name: "user_workspace_roles" })
@Index("UQ_user_workspace_roles", ["workspaceId", "accountId"], { unique: true })
@Check(
  "CHK_workspace_membership_role_status",
  `(status = 'removed' AND role_id IS NULL) OR (status IN ('active', 'disabled') AND role_id IS NOT NULL)`,
)
export class WorkspaceMembership extends WorkspaceOwnedBaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  @Index()
  accountId!: string;

  @ManyToOne("Account", { onDelete: "RESTRICT" })
  @JoinColumn({ name: "user_id" })
  account!: Account;

  @Column({ name: "role_id", type: "uuid", nullable: true })
  @Index()
  roleId!: string | null;

  @ManyToOne("Role", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "role_id" })
  role!: Role | null;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: WorkspaceMembershipStatus;

  @Column({ name: "removed_at", type: "timestamptz", nullable: true })
  removedAt!: Date | null;
}
