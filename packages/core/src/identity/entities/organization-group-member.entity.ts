import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Organization } from "./organization.entity.js";
import type { OrganizationGroup } from "./organization-group.entity.js";
import type { User } from "./user.entity.js";
import type { UserOrganization } from "./user-organization.entity.js";
import { BaseEntity } from "./base.entity.js";

@Entity({ name: "organization_group_members" })
@Index(["groupId", "membershipId"], { unique: true })
export class OrganizationGroupMember extends BaseEntity {
  @Column({ name: "organization_id", type: "uuid" })
  @Index()
  organizationId!: string;

  @ManyToOne("Organization", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;

  @Column({ name: "group_id", type: "uuid" })
  @Index()
  groupId!: string;

  @ManyToOne("OrganizationGroup", "members", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "group_id" })
  group!: OrganizationGroup;

  @Column({ name: "membership_id", type: "uuid" })
  @Index()
  membershipId!: string;

  @ManyToOne("UserOrganization", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "membership_id" })
  membership!: UserOrganization;

  @Column({ name: "user_id", type: "uuid" })
  @Index()
  userId!: string;

  @ManyToOne("User", {
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "user_id" })
  user!: User;
}
