import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
} from "typeorm";
import { WorkspaceOwnedBaseEntity } from "../../identity/entities/workspace-owned-base.entity.js";
import type { RuntimeRun } from "./runtime-run.entity.js";

export const RUNTIME_RUN_EVENT_SCHEMA_VERSION = "hermes.run-event/v1" as const;

export const RUNTIME_RUN_EVENT_TYPES = [
  "artifact.created",
  "checkpoint.created",
  "model.output.delta",
  "node.completed",
  "node.failed",
  "node.started",
  "run.cancellation.requested",
  "run.completed",
  "run.failed",
  "run.started",
  "run.status.changed",
  "tool.call.completed",
  "tool.call.started",
  "usage.recorded",
] as const;

export type RuntimeRunEventType = (typeof RUNTIME_RUN_EVENT_TYPES)[number];
export type RuntimeRunEventPayload = Record<string, unknown>;

@Entity({ name: "runtime_run_events" })
@Index("UQ_runtime_run_events_workspace_id", ["workspaceId", "id"], {
  unique: true,
})
@Index(
  "UQ_runtime_run_events_workspace_run_sequence",
  ["workspaceId", "runId", "sequence"],
  { unique: true },
)
@Index(
  "UQ_runtime_run_events_workspace_run_event_key",
  ["workspaceId", "runId", "eventKey"],
  { unique: true },
)
@Check("CHK_runtime_run_events_sequence", `"sequence" > 0`)
@Check(
  "CHK_runtime_run_events_schema_version",
  `"schema_version" = '${RUNTIME_RUN_EVENT_SCHEMA_VERSION}'`,
)
@Check(
  "CHK_runtime_run_events_event_key",
  `"event_key" ~ '^[A-Za-z][A-Za-z0-9._:-]*$'`,
)
@Check(
  "CHK_runtime_run_events_node_id",
  `"node_id" IS NULL OR "node_id" ~ '^[A-Za-z][A-Za-z0-9._:-]*$'`,
)
@Check(
  "CHK_runtime_run_events_type",
  `"type" IN (${RUNTIME_RUN_EVENT_TYPES.map((type) => `'${type}'`).join(", ")})`,
)
@Check(
  "CHK_runtime_run_events_payload",
  `jsonb_typeof("payload") = 'object'`,
)
export class RuntimeRunEvent extends WorkspaceOwnedBaseEntity {
  @Column({ name: "run_id", type: "uuid", update: false })
  runId!: string;

  @ManyToOne("RuntimeRun", { nullable: false, onDelete: "RESTRICT" })
  @JoinColumn([
    { name: "workspace_id", referencedColumnName: "workspaceId" },
    { name: "run_id", referencedColumnName: "id" },
  ])
  run!: RuntimeRun;

  @Column({ type: "integer", update: false })
  sequence!: number;

  @Column({
    name: "schema_version",
    type: "varchar",
    length: 48,
    default: RUNTIME_RUN_EVENT_SCHEMA_VERSION,
    update: false,
  })
  schemaVersion!: typeof RUNTIME_RUN_EVENT_SCHEMA_VERSION;

  @Column({ name: "event_key", type: "varchar", length: 128, update: false })
  eventKey!: string;

  @Column({ type: "varchar", length: 64, update: false })
  type!: RuntimeRunEventType;

  @Column({
    name: "node_id",
    type: "varchar",
    length: 128,
    nullable: true,
    update: false,
  })
  nodeId!: string | null;

  @Column({
    name: "call_id",
    type: "uuid",
    nullable: true,
    update: false,
  })
  callId!: string | null;

  @Column({ name: "occurred_at", type: "timestamptz", update: false })
  occurredAt!: Date;

  @Column({ type: "jsonb", update: false })
  payload!: RuntimeRunEventPayload;
}
