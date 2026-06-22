import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Role } from "./role.entity.js";
import { OrganizationBaseEntity } from "./organization-base.entity.js";

@Entity({ name: "role_permissions" })
@Index(["roleId", "permission"], { unique: true })
export class RolePermission extends OrganizationBaseEntity {
  @Column({ name: "role_id", type: "uuid" })
  @Index()
  roleId!: string;

  @ManyToOne("Role", "rolePermissions", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "role_id" })
  role!: Role;

  @Column({ type: "varchar", length: 160 })
  @Index()
  permission!: string;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;
}
