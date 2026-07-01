import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from "typeorm";
import type { Organization } from "./organization.entity.js";
import type { OrganizationFeatureGroupAccess } from "./organization-feature-group-access.entity.js";
import type { OrganizationGroupMember } from "./organization-group-member.entity.js";
import type { User } from "./user.entity.js";
import { BaseEntity } from "./base.entity.js";

@Entity({ name: "organization_groups" })
@Index(["organizationId", "name"], { unique: true })
export class OrganizationGroup extends BaseEntity {
  @Column({ name: "organization_id", type: "uuid" })
  @Index()
  organizationId!: string;

  @ManyToOne("Organization", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ name: "display_name", type: "varchar", length: 120 })
  displayName!: string;

  @Column({ type: "varchar", length: 40, nullable: true })
  color!: string | null;

  @Column({ type: "text", nullable: true })
  description!: string | null;

  @Column({ name: "created_by_user_id", type: "uuid", nullable: true })
  @Index()
  createdByUserId!: string | null;

  @ManyToOne("User", {
    nullable: true,
    onDelete: "SET NULL",
  })
  @JoinColumn({ name: "created_by_user_id" })
  createdByUser!: User | null;

  @OneToMany("OrganizationGroupMember", "group")
  members!: OrganizationGroupMember[];

  @OneToMany("OrganizationFeatureGroupAccess", "group")
  featureAccess!: OrganizationFeatureGroupAccess[];
}
