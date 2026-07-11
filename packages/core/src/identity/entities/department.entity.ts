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
import type { Organization } from "./organization.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

export type DepartmentStatus = "active" | "disabled";

@Entity({ name: "departments" })
@Index("UQ_departments_tenant_identity", ["tenantId", "id"], { unique: true })
@Index("UQ_departments_active_slug", ["tenantId", "organizationId", "slug"], {
  unique: true,
  where: "deleted_at IS NULL",
})
@Check("CHK_departments_not_self_parent", "parent_department_id IS NULL OR parent_department_id <> id")
export class Department extends TenantOwnedBaseEntity {
  @Column({ name: "organization_id", type: "uuid" })
  @Index()
  organizationId!: string;

  @ManyToOne("Organization", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ name: "parent_department_id", type: "uuid", nullable: true })
  @Index()
  parentDepartmentId!: string | null;

  @ManyToOne("Department", "children", {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "parent_department_id" })
  parentDepartment!: Department | null;

  @OneToMany("Department", "parentDepartment")
  children!: Department[];

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80 })
  slug!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  code!: string | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: DepartmentStatus;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;
}
