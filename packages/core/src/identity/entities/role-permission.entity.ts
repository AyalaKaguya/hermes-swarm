import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Department } from "./department.entity.js";
import type { Organization } from "./organization.entity.js";
import type { Permission } from "./permission.entity.js";
import type { Role } from "./role.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

@Entity({ name: "role_permissions" })
@Index(["tenantId", "roleId", "permission"], { unique: true })
@Index(["tenantId", "roleId", "permissionId"], { unique: true })
export class RolePermission extends TenantOwnedBaseEntity {
  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  @ManyToOne("Organization", "rolePermissions", {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;

  @Column({ name: "department_id", type: "uuid", nullable: true })
  @Index()
  departmentId!: string | null;

  @ManyToOne("Department", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn({ name: "department_id" })
  department!: Department | null;

  @Column({ name: "role_id", type: "uuid" })
  @Index()
  roleId!: string;

  @ManyToOne("Role", "rolePermissions", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "role_id" })
  role!: Role;

  @Column({ name: "permission_id", type: "uuid", nullable: true })
  @Index()
  permissionId!: string | null;

  @ManyToOne("Permission", "rolePermissions", {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "permission_id" })
  permissionRecord!: Permission | null;

  @Column({ type: "varchar", length: 160 })
  @Index()
  permission!: string;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;
}
