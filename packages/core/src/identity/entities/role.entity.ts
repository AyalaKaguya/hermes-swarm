import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import type { Department } from "./department.entity.js";
import type { Organization } from "./organization.entity.js";
import type { RolePermission } from "./role-permission.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

export type RoleScope = "tenant" | "organization" | "department";

@Entity({ name: "roles" })
@Index("UQ_roles_tenant_name", ["tenantId", "name"], {
  unique: true,
  where: "scope = 'tenant' AND organization_id IS NULL AND department_id IS NULL",
})
@Index("UQ_roles_organization_name", ["tenantId", "organizationId", "name"], {
  unique: true,
  where: "scope = 'organization' AND department_id IS NULL",
})
@Index("UQ_roles_department_name", ["tenantId", "departmentId", "name"], {
  unique: true,
  where: "scope = 'department'",
})
@Check(
  "CHK_roles_scope_columns",
  "(scope = 'tenant' AND organization_id IS NULL AND department_id IS NULL) OR " +
    "(scope = 'organization' AND organization_id IS NOT NULL AND department_id IS NULL) OR " +
    "(scope = 'department' AND organization_id IS NOT NULL AND department_id IS NOT NULL)",
)
export class Role extends TenantOwnedBaseEntity {
  @Column({ type: "varchar", length: 24, default: "tenant" })
  scope!: RoleScope;

  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  @ManyToOne("Organization", "roles", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;

  @Column({ name: "department_id", type: "uuid", nullable: true })
  @Index()
  departmentId!: string | null;

  @ManyToOne("Department", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "department_id" })
  department!: Department | null;

  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ type: "varchar", length: 120 })
  label!: string;

  @Column({ name: "display_name", type: "varchar", length: 120, nullable: true })
  displayName!: string | null;

  @Column({ type: "varchar", length: 40, nullable: true })
  color!: string | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "is_system", type: "boolean", default: false })
  isSystem!: boolean;

  @OneToMany("RolePermission", "role")
  rolePermissions!: RolePermission[];

  @OneToMany("UserOrganization", "role")
  organizationMembers!: UserOrganization[];

}
