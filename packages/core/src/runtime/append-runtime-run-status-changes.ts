import type { EntityManager } from "typeorm";
import {
  RUNTIME_RUN_EVENT_SCHEMA_VERSION,
  RuntimeRunEvent,
} from "./entities/runtime-run-event.entity.js";
import type { RuntimeRunStatus } from "./entities/runtime-run.entity.js";

const STATUS_CHANGED_EVENT_TYPE = "run.status.changed" as const;
const RUNTIME_RUN_STATUSES = new Set<RuntimeRunStatus>([
  "cancelled",
  "cancelling",
  "failed",
  "queued",
  "running",
  "succeeded",
  "timedOut",
  "waiting",
]);

export type RuntimeRunStatusChange = Readonly<{
  from: RuntimeRunStatus;
  reasonCode?: string | null;
  runId: string;
  to: RuntimeRunStatus;
  workspaceId: string;
}>;

export class RuntimeRunStatusChangeValidationError extends Error {
  constructor() {
    super("Runtime run status change input or transaction context is invalid.");
    this.name = "RuntimeRunStatusChangeValidationError";
  }
}

export class RuntimeRunStatusChangeInvariantError extends Error {
  constructor() {
    super("Runtime run status change does not match durable Run state.");
    this.name = "RuntimeRunStatusChangeInvariantError";
  }
}

/**
 * Appends durable status-change events on the caller's active transaction.
 * The parent sequence allocation and event insert are one PostgreSQL statement
 * per change, and batch order is preserved deliberately.
 */
export async function appendRuntimeRunStatusChanges(
  manager: EntityManager,
  changes: readonly RuntimeRunStatusChange[],
): Promise<readonly RuntimeRunEvent[]> {
  requireActiveTransaction(manager);
  if (!Array.isArray(changes)) throw new RuntimeRunStatusChangeValidationError();
  const normalizedChanges = changes.map(normalizeChange);
  const events: RuntimeRunEvent[] = [];

  for (const change of normalizedChanges) {
    if (change.from === change.to) continue;
    const rows = (await manager.query(APPEND_STATUS_CHANGE_SQL, [
      change.workspaceId,
      change.runId,
      change.from,
      change.to,
      change.reasonCode,
      RUNTIME_RUN_EVENT_SCHEMA_VERSION,
      STATUS_CHANGED_EVENT_TYPE,
    ])) as RuntimeRunEventRow[];
    if (rows.length !== 1) throw new RuntimeRunStatusChangeInvariantError();
    events.push(readInsertedEvent(rows[0], change));
  }

  return events;
}

const APPEND_STATUS_CHANGE_SQL = `
  WITH database_clock AS MATERIALIZED (
    SELECT clock_timestamp() AS "now"
  ), advanced_run AS (
    UPDATE "runtime_runs" AS runtime_run
    SET
      "event_sequence" = runtime_run."event_sequence" + 1,
      "updated_at" = database_clock."now"
    FROM database_clock
    WHERE runtime_run."workspace_id" = $1
      AND runtime_run."id" = $2
      AND runtime_run."status" = $4
    RETURNING runtime_run."event_sequence"
  )
  INSERT INTO "runtime_run_events" (
    "id",
    "created_at",
    "updated_at",
    "workspace_id",
    "run_id",
    "sequence",
    "schema_version",
    "event_key",
    "type",
    "node_id",
    "call_id",
    "occurred_at",
    "payload"
  )
  SELECT
    uuid_generate_v4(),
    database_clock."now",
    database_clock."now",
    $1::uuid,
    $2::uuid,
    advanced_run."event_sequence",
    $6,
    $7::text || ':' || advanced_run."event_sequence"::text,
    $7,
    NULL,
    NULL,
    database_clock."now",
    jsonb_build_object(
      'from', $3::text,
      'reasonCode', $5::text,
      'to', $4::text
    )
  FROM advanced_run
  CROSS JOIN database_clock
  RETURNING
    "id",
    "created_at" AS "createdAt",
    "updated_at" AS "updatedAt",
    "workspace_id" AS "workspaceId",
    "run_id" AS "runId",
    "sequence",
    "schema_version" AS "schemaVersion",
    "event_key" AS "eventKey",
    "type",
    "node_id" AS "nodeId",
    "call_id" AS "callId",
    "occurred_at" AS "occurredAt",
    "payload"
`;

type NormalizedRuntimeRunStatusChange = Readonly<{
  from: RuntimeRunStatus;
  reasonCode: string | null;
  runId: string;
  to: RuntimeRunStatus;
  workspaceId: string;
}>;

type RuntimeRunEventRow = {
  callId: unknown;
  createdAt: unknown;
  eventKey: unknown;
  id: unknown;
  nodeId: unknown;
  occurredAt: unknown;
  payload: unknown;
  runId: unknown;
  schemaVersion: unknown;
  sequence: unknown;
  type: unknown;
  updatedAt: unknown;
  workspaceId: unknown;
};

function normalizeChange(
  change: RuntimeRunStatusChange,
): NormalizedRuntimeRunStatusChange {
  if (!isPlainRecord(change)) throw new RuntimeRunStatusChangeValidationError();
  const from = requireStatus(change.from);
  const to = requireStatus(change.to);
  return {
    from,
    reasonCode: requireReasonCode(change.reasonCode),
    runId: requireInputUuid(change.runId),
    to,
    workspaceId: requireInputUuid(change.workspaceId),
  };
}

function readInsertedEvent(
  row: RuntimeRunEventRow,
  change: NormalizedRuntimeRunStatusChange,
) {
  const sequence = requirePositiveInteger(row.sequence);
  const eventKey = `${STATUS_CHANGED_EVENT_TYPE}:${sequence}`;
  if (
    requireUuid(row.workspaceId) !== change.workspaceId ||
    requireUuid(row.runId) !== change.runId ||
    row.schemaVersion !== RUNTIME_RUN_EVENT_SCHEMA_VERSION ||
    row.eventKey !== eventKey ||
    row.type !== STATUS_CHANGED_EVENT_TYPE ||
    row.nodeId !== null ||
    row.callId !== null ||
    !matchesPayload(row.payload, change)
  ) {
    throw new RuntimeRunStatusChangeInvariantError();
  }
  return Object.assign(new RuntimeRunEvent(), {
    callId: null,
    createdAt: requireDate(row.createdAt),
    eventKey,
    id: requireUuid(row.id),
    nodeId: null,
    occurredAt: requireDate(row.occurredAt),
    payload: {
      from: change.from,
      reasonCode: change.reasonCode,
      to: change.to,
    },
    runId: change.runId,
    schemaVersion: RUNTIME_RUN_EVENT_SCHEMA_VERSION,
    sequence,
    type: STATUS_CHANGED_EVENT_TYPE,
    updatedAt: requireDate(row.updatedAt),
    workspaceId: change.workspaceId,
  });
}

function matchesPayload(
  value: unknown,
  change: NormalizedRuntimeRunStatusChange,
) {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value).sort();
  return (
    keys.length === 3 &&
    keys[0] === "from" &&
    keys[1] === "reasonCode" &&
    keys[2] === "to" &&
    value.from === change.from &&
    value.reasonCode === change.reasonCode &&
    value.to === change.to
  );
}

function requireActiveTransaction(manager: EntityManager) {
  if (
    !manager ||
    typeof manager.query !== "function" ||
    manager.queryRunner?.isTransactionActive !== true
  ) {
    throw new RuntimeRunStatusChangeValidationError();
  }
}

function requireStatus(value: unknown): RuntimeRunStatus {
  if (
    typeof value !== "string" ||
    !RUNTIME_RUN_STATUSES.has(value as RuntimeRunStatus)
  ) {
    throw new RuntimeRunStatusChangeValidationError();
  }
  return value as RuntimeRunStatus;
}

function requireReasonCode(value: unknown) {
  if (value === undefined || value === null) return null;
  if (
    typeof value !== "string" ||
    value.length > 128 ||
    !/^[A-Za-z][A-Za-z0-9._:-]*$/.test(value)
  ) {
    throw new RuntimeRunStatusChangeValidationError();
  }
  return value;
}

function requireInputUuid(value: unknown) {
  if (!isUuid(value)) throw new RuntimeRunStatusChangeValidationError();
  return value.toLowerCase();
}

function requireUuid(value: unknown) {
  if (!isUuid(value)) throw new RuntimeRunStatusChangeInvariantError();
  return value.toLowerCase();
}

function isUuid(value: unknown): value is string {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    return false;
  }
  return true;
}

function requirePositiveInteger(value: unknown) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new RuntimeRunStatusChangeInvariantError();
  }
  return number;
}

function requireDate(value: unknown) {
  const date =
    value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(date.getTime())) {
    throw new RuntimeRunStatusChangeInvariantError();
  }
  return date;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
