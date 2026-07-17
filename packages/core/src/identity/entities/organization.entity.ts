import {
  Check,
  Column,
  DeleteDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from "typeorm";
import type { User } from "./user.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

/**
 * Lifecycle status for organizations managed through the admin backend.
 */
export type OrganizationStatus = "active" | "suspended";

@Entity({ name: "organizations" })
@Index("UQ_organizations_tenant_identity", ["tenantId", "id"], { unique: true })
@Index("UQ_organizations_active_slug", ["tenantId", "slug"], {
  unique: true,
  where: "deleted_at IS NULL",
})
@Index("UQ_organizations_single_root", ["tenantId"], {
  unique: true,
  where: "parent_organization_id IS NULL AND deleted_at IS NULL",
})
@Check(
  "CHK_organizations_not_self_parent",
  "parent_organization_id IS NULL OR parent_organization_id <> id",
)
/**
 * Represents an organization boundary in the admin backend.
 */
export class Organization extends TenantOwnedBaseEntity {
  /**
   * Display name shown in admin and organization selectors.
   */
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ name: "parent_organization_id", type: "uuid", nullable: true })
  @Index()
  parentOrganizationId!: string | null;

  @ManyToOne("Organization", "children", {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "parent_organization_id" })
  parentOrganization!: Organization | null;

  @OneToMany("Organization", "parentOrganization")
  children!: Organization[];

  @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
  @Index()
  createdByUserId!: string | null;

  @ManyToOne("User", {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "created_by_user_id" })
  createdByUser!: User | null;

  /**
   * Stable URL-safe organization identifier.
   */
  @Column({ type: "varchar", length: 80 })
  slug!: string;

  /**
   * Operational status used to allow or block login.
   */
  @Column({ type: "varchar", length: 24, default: "active" })
  status!: OrganizationStatus;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @OneToMany("UserOrganization", "organization")
  memberships!: UserOrganization[];

}
