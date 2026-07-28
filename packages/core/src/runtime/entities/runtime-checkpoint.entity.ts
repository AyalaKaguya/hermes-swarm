import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { RuntimeCheckpointAdapterStateEnvelope } from "../runtime-checkpoint-state.js";
import type { RuntimeRun } from "./runtime-run.entity.js";

export const RUNTIME_CHECKPOINT_SCHEMA_VERSION =
  "hermes.graph-checkpoint/v1" as const;

@Entity({ name: "runtime_checkpoints" })
@Index("UQ_runtime_checkpoints_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index(
  "UQ_runtime_checkpoints_workspace_run_sequence",
  ["workspaceId", "runId", "sequence"],
  { unique: true },
)
@Index(
  "UQ_runtime_checkpoints_workspace_run_id",
  ["workspaceId", "runId", "id"],
  { unique: true },
)
@Index(
  "UQ_runtime_checkpoints_workspace_run_namespace_checkpoint_key",
  ["workspaceId", "runId", "namespace", "adapterCheckpointKey"],
  { unique: true },
)
@Index(
  "UQ_runtime_checkpoints_workspace_run_namespace_idempotency_key",
  ["workspaceId", "runId", "namespace", "idempotencyKey"],
  { unique: true },
)
@Check("CHK_runtime_checkpoints_sequence", `"sequence" > 0`)
@Check(
  "CHK_runtime_checkpoints_lease_generation",
  `"lease_generation" > 0`,
)
@Check(
  "CHK_runtime_checkpoints_schema_version",
  `"schema_version" = '${RUNTIME_CHECKPOINT_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_runtime_checkpoints_namespace",
  `"namespace" ~ '^[A-Za-z0-9._:/|@-]{0,500}$'`,
)
@Check(
  "CHK_runtime_checkpoints_idempotency_key",
  `"idempotency_key" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'`,
)
@Check(
  "CHK_runtime_checkpoints_state_digest",
  `"state_digest" ~ '^[a-f0-9]{64}$'`,
)
@Check(
  "CHK_runtime_checkpoints_adapter_state",
  `jsonb_typeof("adapter_state") = 'object'
    AND "adapter_state" ?& ARRAY['adapter', 'state']
    AND ("adapter_state" - 'adapter' - 'state') = '{}'::jsonb
    AND jsonb_typeof("adapter_state"->'adapter') = 'object'
    AND ("adapter_state"->'adapter') ?& ARRAY['kind', 'checkpointVersion']
    AND (("adapter_state"->'adapter') - 'kind' - 'checkpointVersion') = '{}'::jsonb
    AND jsonb_typeof("adapter_state"->'adapter'->'kind') = 'string'
    AND length("adapter_state"->'adapter'->>'kind') BETWEEN 1 AND 128
    AND ("adapter_state"->'adapter'->>'kind') ~ '^[a-z][a-z0-9-]*([.][a-z][a-z0-9-]*)+$'
    AND jsonb_typeof("adapter_state"->'adapter'->'checkpointVersion') = 'string'
    AND length("adapter_state"->'adapter'->>'checkpointVersion') BETWEEN 1 AND 128
    AND ("adapter_state"->'adapter'->>'checkpointVersion') ~ '^[A-Za-z0-9][A-Za-z0-9./:_-]*$'`,
)
export class RuntimeCheckpoint extends WorkspaceOwnedBaseEntity {
  @Column({ name: "run_id", type: "uuid", update: false })
  runId!: string;

  @ManyToOne("RuntimeRun", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "run_id", referencedColumnName: "id" },
  ])
  run!: RuntimeRun;

  @Column({ type: "varchar", length: 500, default: "", update: false })
  namespace!: string;

  @Column({ name: "checkpoint_key", type: "uuid", update: false })
  adapterCheckpointKey!: string;

  @Column({
    name: "parent_checkpoint_id",
    type: "uuid",
    nullable: true,
    update: false,
  })
  parentCheckpointId!: string | null;

  @ManyToOne("RuntimeCheckpoint", { nullable: true, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "run_id", referencedColumnName: "runId" },
    { name: "parent_checkpoint_id", referencedColumnName: "id" },
  ])
  parentCheckpoint!: RuntimeCheckpoint | null;

  @Column({ type: "integer", update: false })
  sequence!: number;

  @Column({ name: "lease_generation", type: "integer", update: false })
  leaseGeneration!: number;

  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: RUNTIME_CHECKPOINT_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof RUNTIME_CHECKPOINT_SCHEMA_VERSION;

  @Column({
    name: "idempotency_key",
    type: "varchar",
    length: 200,
    update: false,
  })
  idempotencyKey!: string;

  @Column({ name: "state_digest", type: "char", length: 64, update: false })
  stateDigest!: string;

  @Column({ name: "adapter_state", type: "jsonb", update: false })
  adapterState!: RuntimeCheckpointAdapterStateEnvelope;
}
