import { Column, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Organization } from "./organization.entity.js";
import { TenantOwnedBaseEntity } from "./tenant-owned-base.entity.js";

/**
 * Base for tenant-owned records that may optionally override one organization.
 * Platform-global records must use a dedicated platform entity instead.
 */
export abstract class OrganizationBaseEntity extends TenantOwnedBaseEntity {
  /**
   * Owning organization id, or null for the tenant-wide value.
   */
  @Column({ name: "organization_id", type: "uuid", nullable: true })
  @Index()
  organizationId!: string | null;

  /**
   * Owning organization relation, or null for the tenant-wide value.
   */
  @ManyToOne("Organization", {
    nullable: true,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "organization_id" })
  organization!: Organization | null;
}
