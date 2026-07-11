import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Department } from "./department.entity.js";
import type { Organization } from "./organization.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

export type UserDepartmentStatus = "active" | "disabled" | "invited";

@Entity({ name: "user_departments" })
@Index("UQ_user_departments_tenant_identity", ["tenantId", "id"], { unique: true })
@Index("UQ_user_departments_membership_department", ["tenantId", "membershipId", "departmentId"], {
  unique: true,
})
@Index("UQ_user_departments_single_default", ["tenantId", "membershipId"], {
  unique: true,
  where: "is_default = true AND status = 'active'",
})
export class UserDepartment extends TenantOwnedBaseEntity {
  @Column({ name: "organization_id", type: "uuid" })
  @Index()
  organizationId!: string;

  @ManyToOne("Organization", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ name: "membership_id", type: "uuid" })
  @Index()
  membershipId!: string;

  @ManyToOne("UserOrganization", {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "membership_id" })
  membership!: UserOrganization;

  @Column({ name: "department_id", type: "uuid" })
  @Index()
  departmentId!: string;

  @ManyToOne("Department", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "department_id" })
  department!: Department;

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: UserDepartmentStatus;

  @Column({ name: "joined_at", type: "timestamptz", nullable: true })
  joinedAt!: Date | null;
}
