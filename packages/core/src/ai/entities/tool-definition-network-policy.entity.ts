import { Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { ToolDefinitionVersion } from "./tool-definition-version.entity.js";
import type { ToolNetworkPolicy } from "./tool-network-policy.entity.js";

@Entity({ name: "tool_definition_network_policies" })
@Index(
  "UQ_tool_definition_network_policies_version_policy",
  ["toolDefinitionVersionId", "networkPolicyId"],
  { unique: true },
)
@Index("IDX_tool_definition_network_policies_policy", [
  "networkPolicyId",
  "toolDefinitionVersionId",
])
export class ToolDefinitionNetworkPolicy extends BaseEntity {
  @Column({ name: "tool_definition_version_id", type: "uuid" })
  toolDefinitionVersionId!: string;

  @ManyToOne("ToolDefinitionVersion", {
    nullable: false,
    onDelete: "CASCADE",
  })
  @JoinColumn({ name: "tool_definition_version_id" })
  toolDefinitionVersion!: ToolDefinitionVersion;

  @Column({ name: "network_policy_id", type: "uuid" })
  networkPolicyId!: string;

  @ManyToOne("ToolNetworkPolicy", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "network_policy_id" })
  networkPolicy!: ToolNetworkPolicy;
}
