import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { RuntimeCheckpointJsonValue } from "../runtime-checkpoint-state.js";
import type { RuntimeCheckpoint } from "./runtime-checkpoint.entity.js";

@Entity({ name: "runtime_checkpoint_writes" })
@Index("UQ_runtime_checkpoint_writes_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index(
  "UQ_runtime_checkpoint_writes_identity",
  ["workspaceId", "runId", "checkpointId", "taskId", "writeIndex"],
  { unique: true },
)
@Check(
  "CHK_runtime_checkpoint_writes_task_id",
  `"task_id" ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'`,
)
@Check(
  "CHK_runtime_checkpoint_writes_channel",
  `"channel" ~ '^[A-Za-z0-9_][A-Za-z0-9._:/-]{0,127}$'`,
)
@Check(
  "CHK_runtime_checkpoint_writes_type",
  `"type" ~ '^[a-z][a-z0-9._+-]{0,31}$'`,
)
@Check(
  "CHK_runtime_checkpoint_writes_value",
  `jsonb_typeof("value") IS NOT NULL`,
)
export class RuntimeCheckpointWrite extends WorkspaceOwnedBaseEntity {
  @Column({ name: "run_id", type: "uuid", update: false })
  runId!: string;

  @Column({ name: "checkpoint_id", type: "uuid", update: false })
  checkpointId!: string;

  @ManyToOne("RuntimeCheckpoint", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "run_id", referencedColumnName: "runId" },
    { name: "checkpoint_id", referencedColumnName: "id" },
  ])
  checkpoint!: RuntimeCheckpoint;

  @Column({ name: "task_id", type: "varchar", length: 128, update: false })
  taskId!: string;

  @Column({ name: "write_index", type: "integer", update: false })
  writeIndex!: number;

  @Column({ type: "varchar", length: 128, update: false })
  channel!: string;

  @Column({ type: "varchar", length: 32 })
  type!: string;

  @Column({ type: "jsonb" })
  value!: RuntimeCheckpointJsonValue;
}
