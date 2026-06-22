import {
  Column,
  Entity,
  Index,
  OneToMany,
} from "typeorm";
import type { Role } from "./role.entity.js";
import type { RolePermission } from "./role-permission.entity.js";
import type { OrganizationSetting } from "./organization-setting.entity.js";
import type { User } from "./user.entity.js";
import { BaseEntity } from "./base.entity.js";

export type OrganizationStatus = "active" | "suspended";

@Entity({ name: "organizations" })
@Index(["slug"], { unique: true })
export class Organization extends BaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80 })
  slug!: string;

  @Column({ type: "varchar", length: 80, nullable: true, unique: true })
  subdomain!: string | null;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: OrganizationStatus;

  @OneToMany("User", "organization")
  users!: User[];

  @OneToMany("Role", "organization")
  roles!: Role[];

  @OneToMany("RolePermission", "organization")
  rolePermissions!: RolePermission[];

  @OneToMany("OrganizationSetting", "organization")
  settings!: OrganizationSetting[];
}
