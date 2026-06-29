import { Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type {
  SettingValueOption,
  SettingValueType,
} from "../definitions.js";

@Entity({ name: "platform_settings" })
@Index(["name"], { unique: true })
export class PlatformSetting extends BaseEntity {
  @Column({ type: "varchar", length: 160 })
  name!: string;

  @Column({ type: "text", nullable: true })
  value!: string | null;

  @Column({ name: "value_type", type: "varchar", length: 32, default: "string" })
  valueType!: SettingValueType;

  @Column({ name: "value_options", type: "jsonb", nullable: true })
  valueOptions!: SettingValueOption[] | null;

  @Column({ type: "varchar", length: 80, default: "global" })
  scope!: string;
}
