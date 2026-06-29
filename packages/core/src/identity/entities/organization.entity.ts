import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
} from "typeorm";
import type { Role } from "./role.entity.js";
import type { RolePermission } from "./role-permission.entity.js";
import type { OrganizationSetting } from "./organization-setting.entity.js";
import type { User } from "./user.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { BaseEntity } from "./base.entity.js";

/**
 * Lifecycle status for organizations managed through the admin backend.
 */
export type OrganizationStatus = "active" | "suspended";

@Entity({ name: "organizations" })
@Index(["slug"], { unique: true })
/**
 * Represents an organization boundary in the admin backend.
 */
export class Organization extends BaseEntity {
  /**
   * Display name shown in admin and organization selectors.
   */
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
  @Index()
  createdByUserId!: string | null;

  @ManyToOne("User", {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "created_by_user_id" })
  createdByUser!: User | null;

  /**
   * Stable URL-safe organization identifier.
   */
  @Column({ type: "varchar", length: 80 })
  slug!: string;

  /**
   * Optional organization subdomain used by onboarding and host resolution.
   */
  @Column({ type: "varchar", length: 80, nullable: true, unique: true })
  subdomain!: string | null;

  /**
   * Operational status used to allow or block login.
   */
  @Column({ type: "varchar", length: 24, default: "active" })
  status!: OrganizationStatus;

  /**
   * Marks the default organization.
   */
  @Column({ name: "is_default", type: "boolean", default: false })
  isDefault!: boolean;

  /**
   * Public profile link for the organization profile.
   */
  @Column({ name: "profile_link", type: "varchar", length: 240, nullable: true })
  profileLink!: string | null;

  /**
   * Banner image URL or asset reference.
   */
  @Column({ type: "varchar", length: 500, nullable: true })
  banner!: string | null;

  /**
   * Optional employee count metadata.
   */
  @Column({ name: "total_employees", type: "integer", nullable: true })
  totalEmployees!: number | null;

  /**
   * Short organization description for profile and admin views.
   */
  @Column({ name: "short_description", type: "text", nullable: true })
  shortDescription!: string | null;

  /**
   * Customer or domain focus text for organization settings.
   */
  @Column({ name: "client_focus", type: "text", nullable: true })
  clientFocus!: string | null;

  /**
   * Long-form organization overview.
   */
  @Column({ type: "text", nullable: true })
  overview!: string | null;

  /**
   * Organization avatar or logo URL.
   */
  @Column({ name: "image_url", type: "varchar", length: 500, nullable: true })
  imageUrl!: string | null;

  @Column({ name: "logo_url", type: "varchar", length: 500, nullable: true })
  logoUrl!: string | null;

  /**
   * Preferred currency code for organization-level defaults.
   */
  @Column({ type: "varchar", length: 12, nullable: true })
  currency!: string | null;

  /**
   * Preferred time zone for organization operations.
   */
  @Column({ name: "time_zone", type: "varchar", length: 40, nullable: true })
  timeZone!: string | null;

  /**
   * Region code used by localization-aware features.
   */
  @Column({ name: "region_code", type: "varchar", length: 40, nullable: true })
  regionCode!: string | null;

  /**
   * Brand color for organization presentation.
   */
  @Column({ name: "brand_color", type: "varchar", length: 40, nullable: true })
  brandColor!: string | null;

  /**
   * Date format preferred by the organization.
   */
  @Column({ name: "date_format", type: "varchar", length: 40, nullable: true })
  dateFormat!: string | null;

  /**
   * Legal or official organization name.
   */
  @Column({ name: "official_name", type: "varchar", length: 180, nullable: true })
  officialName!: string | null;

  /**
   * Organization website URL.
   */
  @Column({ type: "varchar", length: 240, nullable: true })
  website!: string | null;

  /**
   * Preferred language code for organization defaults.
   */
  @Column({ name: "preferred_language", type: "varchar", length: 16, nullable: true })
  preferredLanguage!: string | null;

  @OneToMany("UserOrganization", "organization")
  memberships!: UserOrganization[];

  @OneToMany("Role", "organization")
  roles!: Role[];

  @OneToMany("RolePermission", "organization")
  rolePermissions!: RolePermission[];

  @OneToMany("OrganizationSetting", "organization")
  settings!: OrganizationSetting[];
}
