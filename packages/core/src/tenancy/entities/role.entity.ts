import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import type { PlatformMember } from "./platform-member.entity.js";
import type { RolePermission } from "./role-permission.entity.js";
import type { User } from "./user.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { OrganizationBaseEntity } from "./organization-base.entity.js";

export type RoleScope = "platform" | "organization";

@Entity({ name: "roles" })
@Index(["organizationId", "name"], { unique: true })
export class Role extends OrganizationBaseEntity {
  @Column({ type: "varchar", length: 24, default: "organization" })
  scope!: RoleScope;

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

  @OneToMany("User", "role")
  users!: User[];

  @OneToMany("UserOrganization", "role")
  organizationMembers!: UserOrganization[];

  @OneToMany("PlatformMember", "role")
  platformMembers!: PlatformMember[];
}
