import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import type { RolePermission } from "./role-permission.entity.js";
import type { User } from "./user.entity.js";
import { OrganizationBaseEntity } from "./organization-base.entity.js";

@Entity({ name: "roles" })
@Index(["organizationId", "name"], { unique: true })
export class Role extends OrganizationBaseEntity {
  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ type: "varchar", length: 120 })
  label!: string;

  @Column({ name: "is_system", type: "boolean", default: false })
  isSystem!: boolean;

  @OneToMany("RolePermission", "role")
  rolePermissions!: RolePermission[];

  @OneToMany("User", "role")
  users!: User[];
}
