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

  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  @Column({ name: "profile_link", type: "varchar", length: 240, nullable: true })
  profileLink!: string | null;

  @Column({ type: "varchar", length: 500, nullable: true })
  banner!: string | null;

  @Column({ name: "total_employees", type: "integer", nullable: true })
  totalEmployees!: number | null;

  @Column({ name: "short_description", type: "text", nullable: true })
  shortDescription!: string | null;

  @Column({ name: "client_focus", type: "text", nullable: true })
  clientFocus!: string | null;

  @Column({ type: "text", nullable: true })
  overview!: string | null;

  @Column({ name: "image_url", type: "varchar", length: 500, nullable: true })
  imageUrl!: string | null;

  @Column({ type: "varchar", length: 12, nullable: true })
  currency!: string | null;

  @Column({ name: "time_zone", type: "varchar", length: 40, nullable: true })
  timeZone!: string | null;

  @Column({ name: "region_code", type: "varchar", length: 40, nullable: true })
  regionCode!: string | null;

  @Column({ name: "brand_color", type: "varchar", length: 40, nullable: true })
  brandColor!: string | null;

  @Column({ name: "date_format", type: "varchar", length: 40, nullable: true })
  dateFormat!: string | null;

  @Column({ name: "official_name", type: "varchar", length: 180, nullable: true })
  officialName!: string | null;

  @Column({ type: "varchar", length: 240, nullable: true })
  website!: string | null;

  @Column({ name: "preferred_language", type: "varchar", length: 16, nullable: true })
  preferredLanguage!: string | null;

  @OneToMany("User", "organization")
  users!: User[];

  @OneToMany("Role", "organization")
  roles!: Role[];

  @OneToMany("RolePermission", "organization")
  rolePermissions!: RolePermission[];

  @OneToMany("OrganizationSetting", "organization")
  settings!: OrganizationSetting[];
}
