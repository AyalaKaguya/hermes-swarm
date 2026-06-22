import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { MenuPermission } from "./menu-permission.entity.js";
import { Organization } from "./organization.entity.js";

export type TenantUserStatus = "active" | "disabled";

@Entity({ name: "tenant_users" })
@Index(["organizationId", "email"], { unique: true })
export class TenantUser {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "organization_id", type: "uuid" })
  organizationId!: string;

  @ManyToOne(() => Organization, (organization) => organization.users, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ name: "display_name", type: "varchar", length: 120 })
  displayName!: string;

  @Column({ type: "varchar", length: 160 })
  email!: string;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: TenantUserStatus;

  @CreateDateColumn({ name: "created_at", type: "timestamp with time zone" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp with time zone" })
  updatedAt!: Date;

  @OneToMany(() => MenuPermission, (permission) => permission.user)
  menuPermissions!: MenuPermission[];
}
