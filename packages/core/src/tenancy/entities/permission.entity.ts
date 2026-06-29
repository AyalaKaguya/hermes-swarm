import { Column, Entity, Index, OneToMany } from "typeorm";
import type { RolePermission } from "./role-permission.entity.js";
import { BaseEntity } from "./base.entity.js";

export type PermissionAction = "create" | "read" | "update" | "delete";
export type PermissionScope = "platform" | "organization" | "own";

@Entity({ name: "permissions" })
@Index(["entity", "action", "scope"], { unique: true })
export class Permission extends BaseEntity {
  @Column({ type: "varchar", length: 80 })
  entity!: string;

  @Column({ type: "varchar", length: 24 })
  action!: PermissionAction;

  @Column({ type: "varchar", length: 24 })
  scope!: PermissionScope;

  @Column({ type: "varchar", length: 240, nullable: true })
  description!: string | null;

  @OneToMany("RolePermission", "permissionRecord")
  rolePermissions!: RolePermission[];
}
