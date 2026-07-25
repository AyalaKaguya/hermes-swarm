import { Check, Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { ToolCatalogStatus } from "./tool-entity.types.js";

@Entity({ name: "tool_definitions" })
@Index("UQ_tool_definitions_name", ["name"], { unique: true })
@Check("CHK_tool_definitions_status", `"status" IN ('enabled', 'disabled')`)
@Check("CHK_tool_definitions_revision", `"revision" > 0`)
export class ToolDefinition extends BaseEntity {
  @Column({ type: "varchar", length: 128 })
  name!: string;

  @Column({ name: "display_name", type: "varchar", length: 120 })
  displayName!: string;

  @Column({ type: "text" })
  description!: string;

  @Column({ type: "varchar", length: 24, default: "disabled" })
  status!: ToolCatalogStatus;

  @Column({ type: "integer", default: 1 })
  revision!: number;
}
