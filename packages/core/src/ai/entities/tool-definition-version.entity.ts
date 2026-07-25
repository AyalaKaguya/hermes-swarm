import { Check, Column, Entity, Index, JoinColumn, ManyToOne } from "typeorm";
import { BaseEntity } from "../../identity/entities/base.entity.js";
import type { ToolDefinition } from "./tool-definition.entity.js";
import type {
  ToolDefinitionVersionStatus,
  ToolDefinitionSchemaVersion,
  ToolDriverType,
  ToolIdempotency,
  ToolJsonObject,
  ToolRetryPolicy,
  ToolSideEffect,
} from "./tool-entity.types.js";

@Entity({ name: "tool_definition_versions" })
@Index(
  "UQ_tool_definition_versions_definition_version",
  ["toolDefinitionId", "version"],
  { unique: true },
)
@Index("IDX_tool_definition_versions_definition_status", [
  "toolDefinitionId",
  "status",
])
@Check(
  "CHK_tool_definition_versions_driver",
  `"driver_type" IN ('internal', 'http', 'mcpStreamableHttp')`,
)
@Check(
  "CHK_tool_definition_versions_schema_version",
  `"schema_version" = 'hermes.tool-definition/v1'`,
)
@Check(
  "CHK_tool_definition_versions_status",
  `"status" IN ('draft', 'published', 'disabled')`,
)
@Check("CHK_tool_definition_versions_revision", `"revision" > 0`)
@Check(
  "CHK_tool_definition_versions_lock_state",
  `"content_locked" OR "status" = 'draft'`,
)
@Check(
  "CHK_tool_definition_versions_digest",
  `"content_digest" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_tool_definition_versions_schema_objects",
  `jsonb_typeof("input_schema") = 'object' AND jsonb_typeof("output_schema") = 'object' AND jsonb_typeof("driver_config") = 'object' AND jsonb_typeof("retry") = 'object'`,
)
@Check(
  "CHK_tool_definition_versions_array_fields",
  `jsonb_typeof("required_permissions") = 'array' AND jsonb_typeof("output_redaction_paths") = 'array'`,
)
@Check(
  "CHK_tool_definition_versions_timeout",
  `"timeout_ms" BETWEEN 100 AND 120000`,
)
@Check(
  "CHK_tool_definition_versions_response_bytes",
  `"max_response_bytes" BETWEEN 1024 AND 10485760`,
)
@Check(
  "CHK_tool_definition_versions_side_effect",
  `"side_effect" IN ('none', 'reversible', 'irreversible')`,
)
@Check(
  "CHK_tool_definition_versions_idempotency",
  `"idempotency" IN ('notRequired', 'required', 'unsupported')`,
)
export class ToolDefinitionVersion extends BaseEntity {
  @Column({ name: "tool_definition_id", type: "uuid" })
  toolDefinitionId!: string;

  @ManyToOne("ToolDefinition", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn({ name: "tool_definition_id" })
  toolDefinition!: ToolDefinition;

  @Column({ type: "varchar", length: 64 })
  version!: string;

  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: "hermes.tool-definition/v1",
  })
  schemaVersion!: ToolDefinitionSchemaVersion;

  @Column({ name: "driver_type", type: "varchar", length: 32 })
  driverType!: ToolDriverType;

  @Column({ type: "varchar", length: 24, default: "draft" })
  status!: ToolDefinitionVersionStatus;

  @Column({ type: "integer", default: 1 })
  revision!: number;

  /** Internal creation latch; public version content is immutable once locked. */
  @Column({
    name: "content_locked",
    type: "boolean",
    default: true,
    select: false,
  })
  contentLocked!: boolean;

  @Column({ name: "content_digest", type: "char", length: 64 })
  contentDigest!: string;

  @Column({ name: "input_schema", type: "jsonb" })
  inputSchema!: ToolJsonObject;

  @Column({ name: "output_schema", type: "jsonb" })
  outputSchema!: ToolJsonObject;

  @Column({ name: "driver_config", type: "jsonb" })
  driverConfig!: ToolJsonObject;

  @Column({
    name: "required_permissions",
    type: "jsonb",
    default: () => "'[]'::jsonb",
  })
  requiredPermissions!: string[];

  @Column({
    name: "output_redaction_paths",
    type: "jsonb",
    default: () => "'[]'::jsonb",
  })
  outputRedactionPaths!: string[];

  @Column({ name: "allows_artifact", type: "boolean", default: false })
  allowsArtifact!: boolean;

  @Column({ name: "timeout_ms", type: "integer" })
  timeoutMs!: number;

  @Column({ name: "max_response_bytes", type: "integer" })
  maxResponseBytes!: number;

  @Column({ type: "jsonb" })
  retry!: ToolRetryPolicy;

  @Column({ name: "side_effect", type: "varchar", length: 24 })
  sideEffect!: ToolSideEffect;

  @Column({ type: "varchar", length: 24 })
  idempotency!: ToolIdempotency;
}
