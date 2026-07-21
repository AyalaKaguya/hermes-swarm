import { Column, Entity, Index } from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { SettingValueOption, SettingValueType } from "../definitions.js";

@Entity({ name: "workspace_settings" })
@Index("UQ_workspace_settings_name", ["workspaceId", "name"], { unique: true })
export class WorkspaceSetting extends WorkspaceOwnedBaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "text", nullable: true })
  value!: string | null;

  @Column({ name: "value_type", type: "varchar", length: 32, default: "string" })
  valueType!: SettingValueType;

  @Column({ name: "value_options", type: "jsonb", nullable: true })
  valueOptions!: SettingValueOption[] | null;
}
