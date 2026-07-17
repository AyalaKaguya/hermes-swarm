import { Check, Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import type { Organization } from "./organization.entity.js";
import type { RolePermission } from "./role-permission.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

export type RoleScope = "tenant" | "organization";

@Entity({ name: "roles" })
@Index("UQ_roles_tenant_name", ["tenantId", "name"], {
  unique: true,
  where: "scope = 'tenant' AND organization_id IS NULL",
})
@Index("UQ_roles_organization_name", ["tenantId", "organizationId", "name"], {
  unique: true,
  where: "scope = 'organization' AND organization_id IS NOT NULL",
})
@Index("UQ_roles_tenant_organization_identity", ["tenantId", "organizationId", "id"], { unique: true })
@Check(
  "CHK_roles_scope_owner",
  "(scope = 'tenant' AND organization_id IS NULL) OR (scope = 'organization' AND organization_id IS NOT NULL)",
)
export class Role extends TenantOwnedBaseEntity {
  @Column({ type: "varchar", length: 24, default: "tenant" })
  scope!: RoleScope;

  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  @ManyToOne("Organization", { nullable: true, onDelete: "CASCADE" })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;

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

}
