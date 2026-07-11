import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Organization } from "./organization.entity.js";
import type { Role } from "./role.entity.js";
import type { User } from "./user.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

export type UserOrganizationStatus = "active" | "disabled" | "invited";

@Entity({ name: "user_organizations" })
@Index("UQ_user_organizations_tenant_identity", ["tenantId", "id"], { unique: true })
@Index(["tenantId", "userId", "organizationId"], { unique: true })
@Index("UQ_user_organizations_single_default", ["tenantId", "userId"], {
  unique: true,
  where: "is_default = true AND status = 'active'",
})
export class UserOrganization extends TenantOwnedBaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne("User", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ name: "organization_id", type: "uuid" })
  @Index()
  organizationId!: string;

  @ManyToOne("Organization", "memberships", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ name: "role_id", type: "uuid", nullable: true })
  @Index()
  roleId!: string | null;

  @ManyToOne("Role", "organizationMembers", {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "role_id" })
  role!: Role | null;

  @Column({ name: "display_name", type: "varchar", length: 120, nullable: true })
  displayName!: string | null;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: UserOrganizationStatus;

  @Column({ name: "joined_at", type: "timestamptz", nullable: true })
  joinedAt!: Date | null;
}
