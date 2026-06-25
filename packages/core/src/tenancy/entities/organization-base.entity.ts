import { Column, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Organization } from "./organization.entity.js";
import { BaseEntity } from "./base.entity.js";

/**
 * Base entity for records that can be scoped to one organization or stored as
 * global defaults.
 */
export abstract class OrganizationBaseEntity extends BaseEntity {
  /**
   * Owning organization id, or null for global records.
   */
  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  /**
   * Owning organization relation, or null for global records.
   */
  @ManyToOne("Organization", {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;
}
