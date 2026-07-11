import { Column, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Tenant } from "./tenant.entity.js";
import { BaseEntity } from "./base.entity.js";

/** Base for every record that belongs to exactly one tenant data plane. */
export abstract class TenantOwnedBaseEntity extends BaseEntity {
  @Column({ name: "tenant_id", type: "uuid" })
  @Index()
  tenantId!: string;

  @ManyToOne("Tenant", {
    nullable: false,
    onDelete: "RESTRICT",
  })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;
}
