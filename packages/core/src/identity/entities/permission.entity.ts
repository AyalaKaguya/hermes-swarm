import { Column, Entity, Index, OneToMany } from "typeorm";
import type { RolePermission } from "./role-permission.entity.js";
import { BaseEntity } from "./base.entity.js";

export type PermissionAction = string;
export type PermissionScope =
  | "platform"
  | "tenant"
  | "organization"
  | "department"
  | "own";
export type PermissionCatalogSource = "controller" | "manual" | "navigation";

@Entity({ name: "permissions" })
@Index(["code"], { unique: true })
export class Permission extends BaseEntity {
  @Column({ type: "varchar", length: 220, nullable: true })
  code!: string | null;

  @Column({ type: "varchar", length: 80 })
  entity!: string;

  @Column({ name: "entity_label", type: "varchar", length: 120, nullable: true })
  entityLabel!: string | null;

  @Column({ name: "entity_order", type: "integer", nullable: true })
  entityOrder!: number | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  purpose!: string | null;

  @Column({ name: "purpose_label", type: "varchar", length: 120, nullable: true })
  purposeLabel!: string | null;

  @Column({ name: "purpose_order", type: "integer", nullable: true })
  purposeOrder!: number | null;

  @Column({ type: "varchar", length: 80, nullable: true })
  operation!: string | null;

  @Column({ name: "operation_label", type: "varchar", length: 120, nullable: true })
  operationLabel!: string | null;

  @Column({ name: "operation_order", type: "integer", nullable: true })
  operationOrder!: number | null;

  @Column({ type: "varchar", length: 24, nullable: true })
  action!: PermissionAction | null;

  @Column({ type: "varchar", length: 24 })
  scope!: PermissionScope;

  @Column({ type: "varchar", length: 240, nullable: true })
  description!: string | null;

  @Column({ name: "is_dangerous", type: "boolean", default: false })
  isDangerous!: boolean;

  @Column({ type: "varchar", length: 32, default: "controller" })
  source!: PermissionCatalogSource;

  @Column({ name: "default_roles", type: "jsonb", nullable: true })
  defaultRoles!: string[] | null;

  @OneToMany("RolePermission", "permissionRecord")
  rolePermissions!: RolePermission[];
}
