import { Column, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Organization } from "./organization.entity.js";
import { TenantBaseEntity } from "./tenant-base.entity.js";

export abstract class TenantOrganizationBaseEntity extends TenantBaseEntity {
  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string;

  @ManyToOne("Organization", {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization;
}
