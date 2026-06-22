import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { User } from "./user.entity.js";
import { TenantOrganizationBaseEntity } from "./tenant-organization-base.entity.js";

export type UserOrganizationPreferences = Record<string, unknown>;

@Entity({ name: "user_organizations" })
@Index(["userId", "organizationId"], { unique: true })
export class UserOrganization extends TenantOrganizationBaseEntity {
  @Column({ name: "user_id", type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne("User", "organizations", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id" })
  user!: User;

  @Column({ name: "is_default", type: "boolean", default: true })
  isDefault!: boolean;

  @Column({ name: "is_active", type: "boolean", default: true })
  isActive!: boolean;

  @Column({ type: "jsonb", nullable: true })
  preferences!: UserOrganizationPreferences | null;
}
