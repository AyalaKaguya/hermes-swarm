import { Check, Column, Entity, Index } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type {
  ToolCatalogStatus,
  ToolNetworkScheme,
} from "./tool-entity.types.js";

@Entity({ name: "tool_network_policies" })
@Index("UQ_tool_network_policies_name", ["name"], { unique: true })
@Index(
  "UQ_tool_network_policies_endpoint",
  ["scheme", "host", "port", "pathPrefix"],
  { unique: true },
)
@Check("CHK_tool_network_policies_scheme", `"scheme" IN ('https', 'http')`)
@Check("CHK_tool_network_policies_port", `"port" BETWEEN 1 AND 65535`)
@Check("CHK_tool_network_policies_path", `left("path_prefix", 1) = '/'`)
@Check(
  "CHK_tool_network_policies_status",
  `"status" IN ('enabled', 'disabled')`,
)
@Check("CHK_tool_network_policies_revision", `"revision" > 0`)
export class ToolNetworkPolicy extends BaseEntity {
  @Column({ type: "varchar", length: 120 })
  name!: string;

  @Column({ type: "varchar", length: 8 })
  scheme!: ToolNetworkScheme;

  @Column({ type: "varchar", length: 253 })
  host!: string;

  @Column({ type: "integer" })
  port!: number;

  @Column({ name: "path_prefix", type: "varchar", length: 500 })
  pathPrefix!: string;

  @Column({ type: "varchar", length: 24, default: "disabled" })
  status!: ToolCatalogStatus;

  @Column({ type: "integer", default: 1 })
  revision!: number;
}
