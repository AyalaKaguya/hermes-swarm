import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Permission } from "./permission.entity.js";
import type { Role } from "./role.entity.js";
import { BaseEntity } from "./base.entity.js";

@Entity({ name: "role_permissions" })
@Index("UQ_role_permissions_role_permission", ["roleId", "permissionId"], { unique: true })
export class RolePermission extends BaseEntity {
  @Column({ name: "role_id", type: "uuid" })
  @Index()
  roleId!: string;

  @ManyToOne("Role", "rolePermissions", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "role_id" })
  role!: Role;

  @Column({ name: "permission_id", type: "uuid" })
  @Index()
  permissionId!: string;

  @ManyToOne("Permission", "rolePermissions", { onDelete: "CASCADE" })
  @JoinColumn({ name: "permission_id" })
  permissionRecord!: Permission;

  @Column({ type: "boolean", default: false })
  enabled!: boolean;

  get permission() {
    return this.permissionRecord?.code ?? "";
  }
}
