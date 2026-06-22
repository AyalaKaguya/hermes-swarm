import { Column, Entity, Index, OneToMany } from "typeorm";
import type { Organization } from "./organization.entity.js";
import type { RolePermission } from "./role-permission.entity.js";
import type { Role } from "./role.entity.js";
import type { TenantSetting } from "./tenant-setting.entity.js";
import type { User } from "./user.entity.js";
import { BaseEntity } from "./base.entity.js";

export type TenantStatus = "active" | "suspended";

@Entity({ name: "tenants" })
@Index(["slug"], { unique: true })
export class Tenant extends BaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80 })
  slug!: string;

  @Column({ type: "varchar", length: 80, nullable: true, unique: true })
  subdomain!: string | null;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: TenantStatus;

  @OneToMany("Organization", "tenant")
  organizations!: Organization[];

  @OneToMany("User", "tenant")
  users!: User[];

  @OneToMany("Role", "tenant")
  roles!: Role[];

  @OneToMany("RolePermission", "tenant")
  rolePermissions!: RolePermission[];

  @OneToMany("TenantSetting", "tenant")
  settings!: TenantSetting[];
}
