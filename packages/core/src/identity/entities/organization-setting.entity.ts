import { Column, Entity, Index } from "typeorm";
import { OrganizationBaseEntity } from "./organization-base.entity.js";
import type {
  SettingValueOption,
  SettingValueType,
} from "../../settings/definitions.js";

@Entity({ name: "organization_settings" })
@Index(["organizationId", "name"], { unique: true })
export class OrganizationSetting extends OrganizationBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "text", nullable: true })
  value!: string | null;

  @Column({ name: "value_type", type: "varchar", length: 32, default: "string" })
  valueType!: SettingValueType;

  @Column({ name: "value_options", type: "jsonb", nullable: true })
  valueOptions!: SettingValueOption[] | null;
}
