import { Column, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Organization } from "./organization.entity.js";
import { BaseEntity } from "./base.entity.js";

export abstract class OrganizationBaseEntity extends BaseEntity {
  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  @ManyToOne("Organization", {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;
}
