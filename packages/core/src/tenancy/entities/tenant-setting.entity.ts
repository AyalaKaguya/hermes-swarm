import { Column, Entity, Index } from "typeorm";
import { TenantBaseEntity } from "./tenant-base.entity.js";

@Entity({ name: "tenant_settings" })
@Index(["tenantId", "name"], { unique: true })
export class TenantSetting extends TenantBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "text", nullable: true })
  value!: string | null;
}
