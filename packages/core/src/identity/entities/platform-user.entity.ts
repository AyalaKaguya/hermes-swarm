import { Column, DeleteDateColumn, Entity, Index, OneToMany } from "typeorm";
import type { PlatformUserRole } from "./platform-user-role.entity.js";
import { BaseEntity } from "./base.entity.js";

export type PlatformUserStatus = "active" | "disabled";

@Entity({ name: "platform_users" })
@Index("UQ_platform_users_email", ["email"], { unique: true })
export class PlatformUser extends BaseEntity {
  @Column({ type: "varchar", length: 160 })
  email!: string;

  @Column({ name: "display_name", type: "varchar", length: 120 })
  displayName!: string;

  @Column({ name: "password_hash", type: "varchar", length: 240, nullable: true })
  passwordHash!: string | null;

  @Column({ name: "preferred_language", type: "varchar", length: 16, default: "zh-CN" })
  preferredLanguage!: string;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: PlatformUserStatus;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @OneToMany("PlatformUserRole", "platformUser")
  roles!: PlatformUserRole[];
}
