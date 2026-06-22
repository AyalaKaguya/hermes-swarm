import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import type { Role } from "./role.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { TenantBaseEntity } from "./tenant-base.entity.js";

export type UserStatus = "active" | "disabled";
export type UserType = "service" | "user";

@Entity({ name: "users" })
@Index(["tenantId", "email"], { unique: true })
export class User extends TenantBaseEntity {
  @Column({ type: "varchar", length: 24, default: "user" })
  type!: UserType;

  @Column({ name: "display_name", type: "varchar", length: 120 })
  displayName!: string;

  @Column({ name: "first_name", type: "varchar", length: 80, nullable: true })
  firstName!: string | null;

  @Column({ name: "last_name", type: "varchar", length: 80, nullable: true })
  lastName!: string | null;

  @Column({ type: "varchar", length: 160 })
  @Index()
  email!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  @Index()
  username!: string | null;

  @Column({ name: "password_hash", type: "varchar", length: 240 })
  passwordHash!: string;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: UserStatus;

  @Column({ name: "role_id", type: "uuid", nullable: true })
  @Index()
  roleId!: string | null;

  @ManyToOne("Role", "users", {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "role_id" })
  role!: Role | null;

  @OneToMany("UserOrganization", "user")
  organizations!: UserOrganization[];
}
