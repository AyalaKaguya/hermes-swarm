import { Column, DeleteDateColumn, Entity, Index, OneToMany } from "typeorm";
import type { Department } from "./department.entity.js";
import type { Organization } from "./organization.entity.js";
import type { User } from "./user.entity.js";
import { BaseEntity } from "./base.entity.js";

export type TenantStatus =
  | "provisioning"
  | "active"
  | "suspended"
  | "archived";

@Entity({ name: "tenants" })
@Index("UQ_tenants_active_slug", ["slug"], {
  unique: true,
  where: "deleted_at IS NULL",
})
@Index("UQ_tenants_active_subdomain", ["subdomain"], {
  unique: true,
  where: "subdomain IS NOT NULL AND deleted_at IS NULL",
})
export class Tenant extends BaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80 })
  slug!: string;

  @Column({ type: "varchar", length: 80, nullable: true })
  subdomain!: string | null;

  @Column({ type: "varchar", length: 24, default: "provisioning" })
  status!: TenantStatus;

  @DeleteDateColumn({ name: "deleted_at", type: "timestamptz", nullable: true })
  deletedAt!: Date | null;

  @OneToMany("User", "tenant")
  users!: User[];

  @OneToMany("Organization", "tenant")
  organizations!: Organization[];

  @OneToMany("Department", "tenant")
  departments!: Department[];
}
