import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { MenuPermission } from "./menu-permission.entity.js";
import { TenantUser } from "./tenant-user.entity.js";

export type OrganizationStatus = "active" | "suspended";

@Entity({ name: "organizations" })
@Index(["slug"], { unique: true })
export class Organization {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 80 })
  slug!: string;

  @Column({ type: "varchar", length: 24, default: "active" })
  status!: OrganizationStatus;

  @CreateDateColumn({ name: "created_at", type: "timestamp with time zone" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp with time zone" })
  updatedAt!: Date;

  @OneToMany(() => TenantUser, (user) => user.organization)
  users!: TenantUser[];

  @OneToMany(() => MenuPermission, (permission) => permission.organization)
  menuPermissions!: MenuPermission[];
}
