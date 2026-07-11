import { Column, Entity, Index } from "typeorm";
import { TenantOwnedBaseEntity } from "../../identity/entities/tenant-owned-base.entity.js";
import type { SettingValueOption, SettingValueType } from "../definitions.js";

@Entity({ name: "tenant_settings" })
@Index("UQ_tenant_settings_name", ["tenantId", "name"], { unique: true })
export class TenantSetting extends TenantOwnedBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "text", nullable: true })
  value!: string | null;

  @Column({ name: "value_type", type: "varchar", length: 32, default: "string" })
  valueType!: SettingValueType;

  @Column({ name: "value_options", type: "jsonb", nullable: true })
  valueOptions!: SettingValueOption[] | null;
}
