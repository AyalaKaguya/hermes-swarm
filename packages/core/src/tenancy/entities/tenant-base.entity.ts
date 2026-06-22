import { Column, Index, JoinColumn, ManyToOne } from "typeorm";
import type { Tenant } from "./tenant.entity.js";
import { BaseEntity } from "./base.entity.js";

export abstract class TenantBaseEntity extends BaseEntity {
  @Column({ name: "tenant_id", type: "uuid", nullable: true })
  @Index()
  tenantId!: string;

  @ManyToOne("Tenant", {
    nullable: true,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "tenant_id" })
  tenant!: Tenant;
}
