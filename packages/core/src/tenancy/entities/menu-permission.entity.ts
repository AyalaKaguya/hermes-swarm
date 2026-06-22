import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";
import { Menu } from "./menu.entity.js";
import { Organization } from "./organization.entity.js";
import { TenantUser } from "./tenant-user.entity.js";

@Entity({ name: "menu_permissions" })
@Index(["organizationId", "userId", "menuId"], { unique: true })
export class MenuPermission {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ name: "organization_id", type: "uuid" })
  organizationId!: string;

  @ManyToOne(() => Organization, (organization) => organization.menuPermissions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ name: "user_id", type: "uuid" })
  userId!: string;

  @ManyToOne(() => TenantUser, (user) => user.menuPermissions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id" })
  user!: TenantUser;

  @Column({ name: "menu_id", type: "uuid" })
  menuId!: string;

  @ManyToOne(() => Menu, (menu) => menu.permissions, {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "menu_id" })
  menu!: Menu;

  @Column({ name: "can_view", type: "boolean", default: true })
  canView!: boolean;

  @Column({ name: "can_manage", type: "boolean", default: false })
  canManage!: boolean;

  @CreateDateColumn({ name: "created_at", type: "timestamp with time zone" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamp with time zone" })
  updatedAt!: Date;
}
