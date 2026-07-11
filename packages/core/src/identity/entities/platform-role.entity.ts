import { Column, Entity, Index, OneToMany } from "typeorm";
import type { PlatformRolePermission } from "./platform-role-permission.entity.js";
import type { PlatformUserRole } from "./platform-user-role.entity.js";
import { BaseEntity } from "./base.entity.js";

@Entity({ name: "platform_roles" })
@Index("UQ_platform_roles_name", ["name"], { unique: true })
export class PlatformRole extends BaseEntity {
  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ type: "varchar", length: 120 })
  label!: string;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "is_system", type: "boolean", default: false })
  isSystem!: boolean;

  @OneToMany("PlatformRolePermission", "platformRole")
  rolePermissions!: PlatformRolePermission[];

  @OneToMany("PlatformUserRole", "platformRole")
  userRoles!: PlatformUserRole[];
}
