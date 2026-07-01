import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Organization } from "./organization.entity.js";
import type { OrganizationGroup } from "./organization-group.entity.js";
import { BaseEntity } from "./base.entity.js";

@Entity({ name: "organization_feature_group_access" })
@Index(["organizationId", "featureKey", "groupId"], { unique: true })
export class OrganizationFeatureGroupAccess extends BaseEntity {
  @Column({ name: "organization_id", type: "uuid" })
  @Index()
  organizationId!: string;

  @ManyToOne("Organization", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ name: "feature_key", type: "varchar", length: 160 })
  @Index()
  featureKey!: string;

  @Column({ name: "group_id", type: "uuid" })
  @Index()
  groupId!: string;

  @ManyToOne("OrganizationGroup", "featureAccess", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "group_id" })
  group!: OrganizationGroup;
}
