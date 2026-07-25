import { createHash, randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import {
  createGraphCheckpointEnvelope,
  createRuntimeCheckpointPendingWritesEnvelope,
  type GraphCheckpointEnvelope,
  type GraphCheckpointReference,
  type GraphCheckpointStore,
  type GraphExecutionAdapterDescriptor,
  type HermesJsonValue,
  type ListGraphCheckpointsRequest,
  type LoadGraphCheckpointRequest,
  type LoadLatestGraphCheckpointRequest,
  type LoadRuntimeCheckpointPendingWritesRequest,
  type RuntimeCheckpointPendingWrite,
  type RuntimeCheckpointPendingWritesEnvelope,
  type SaveGraphCheckpointRequest,
  type SaveRuntimeCheckpointPendingWritesRequest,
} from "@hermes-swarm/agent-sdk";
import {
  createRuntimeCheckpointAdapterStateEnvelope,
  createRuntimeCheckpointPendingWrite,
  normalizeRuntimeCheckpointAdapterKey,
  normalizeRuntimeCheckpointIdempotencyKey,
  normalizeRuntimeCheckpointNamespace,
  normalizeRuntimeCheckpointStateDigest,
  parseRuntimeCheckpointAdapterStateEnvelope,
  parseRuntimeCheckpointLeaseGeneration,
  parseRuntimeCheckpointSequence,
  RUNTIME_CHECKPOINT_SCHEMA_VERSION,
  RUNTIME_RUN_EVENT_SCHEMA_VERSION,
  type RuntimeCheckpointAdapterStateEnvelope,
} from "@hermes-swarm/core/runtime";
import { DataSource, type EntityManager } from "typeorm";
import { TrustedRunContextService } from "./trusted-run-context.service.js";

const CHECKPOINT_CREATED_EVENT_TYPE = "checkpoint.created" as const;
const MAX_LIST_LIMIT = 200;

export const RUNTIME_CHECKPOINT_STORE_ERROR_CODES = Object.freeze({
  conflict: "RUNTIME_CHECKPOINT_CONFLICT",
  invalid: "RUNTIME_CHECKPOINT_INVALID",
  staleLease: "RUNTIME_CHECKPOINT_STALE_LEASE",
} as const);

type RuntimeCheckpointStoreErrorCode =
  (typeof RUNTIME_CHECKPOINT_STORE_ERROR_CODES)[keyof typeof RUNTIME_CHECKPOINT_STORE_ERROR_CODES];

export class RuntimeCheckpointStoreError extends Error {
  constructor(readonly code: RuntimeCheckpointStoreErrorCode) {
    super(messageFor(code));
    this.name = "RuntimeCheckpointStoreError";
  }
}

type QueryExecutor = Pick<DataSource, "query"> | Pick<EntityManager, "query">;

type CheckpointRow = {
  adapter_state: unknown;
  checkpoint_id: unknown;
  checkpoint_key: unknown;
  lease_generation: unknown;
  namespace: unknown;
  parent_checkpoint_id: unknown;
  parent_checkpoint_key: unknown;
  run_id: unknown;
  schema_version: unknown;
  sequence: unknown;
  state_digest: unknown;
  workspace_id: unknown;
};

type CheckpointWriteRow = {
  channel: unknown;
  task_id: unknown;
  type: unknown;
  value: unknown;
  write_index: unknown;
};

@Injectable()
export class TypeOrmRuntimeCheckpointStore implements GraphCheckpointStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly trustedContext: TrustedRunContextService,
  ) {}

  async loadLatest(
    request: LoadLatestGraphCheckpointRequest,
  ): Promise<GraphCheckpointEnvelope | null> {
    const scope = this.readScope(request);
    const rows = (await this.dataSource.query(
      `${CHECKPOINT_SELECT}
       WHERE checkpoint."workspace_id" = $1
         AND checkpoint."run_id" = $2
         AND checkpoint."namespace" = $3
       ORDER BY checkpoint."sequence" DESC
       LIMIT 1`,
      [scope.workspaceId, scope.runId, scope.namespace],
    )) as CheckpointRow[];
    return this.readSingleCheckpoint(this.dataSource, rows, false);
  }

  async load(
    request: LoadGraphCheckpointRequest,
  ): Promise<GraphCheckpointEnvelope | null> {
    const scope = this.readScope(request);
    const adapterCheckpointKey = checkpointKey(request.adapterCheckpointKey);
    const rows = (await this.dataSource.query(
      `${CHECKPOINT_SELECT}
       WHERE checkpoint."workspace_id" = $1
         AND checkpoint."run_id" = $2
         AND checkpoint."namespace" = $3
         AND checkpoint."checkpoint_key" = $4`,
      [
        scope.workspaceId,
        scope.runId,
        scope.namespace,
        adapterCheckpointKey,
      ],
    )) as CheckpointRow[];
    return this.readSingleCheckpoint(this.dataSource, rows, false);
  }

  async list(
    request: ListGraphCheckpointsRequest,
  ): Promise<readonly GraphCheckpointEnvelope[]> {
    const scope = this.readScope(request);
    const limit = listLimit(request.limit);
    const before =
      request.beforeAdapterCheckpointKey === undefined
        ? null
        : checkpointKey(request.beforeAdapterCheckpointKey);
    const rows = (await this.dataSource.query(
      `${CHECKPOINT_SELECT}
       WHERE checkpoint."workspace_id" = $1
         AND checkpoint."run_id" = $2
         AND checkpoint."namespace" = $3
         AND (
           $4::uuid IS NULL
           OR checkpoint."sequence" < COALESCE((
             SELECT before_checkpoint."sequence"
             FROM "runtime_checkpoints" AS before_checkpoint
             WHERE before_checkpoint."workspace_id" = $1
               AND before_checkpoint."run_id" = $2
               AND before_checkpoint."namespace" = $3
               AND before_checkpoint."checkpoint_key" = $4
           ), 0)
         )
       ORDER BY checkpoint."sequence" DESC
       LIMIT $5`,
      [scope.workspaceId, scope.runId, scope.namespace, before, limit],
    )) as CheckpointRow[];

    const checkpoints: GraphCheckpointEnvelope[] = [];
    for (const row of rows) {
      checkpoints.push(await this.readCheckpoint(this.dataSource, row));
    }
    return Object.freeze(checkpoints);
  }

  async save(
    request: SaveGraphCheckpointRequest,
  ): Promise<GraphCheckpointEnvelope> {
    const input = this.readSaveRequest(request);
    return this.dataSource.transaction(async (manager) => {
      await this.lockActiveLease(manager, input.lease);

      const existingRows = (await manager.query(
        `${CHECKPOINT_SELECT}
         WHERE checkpoint."workspace_id" = $1
           AND checkpoint."run_id" = $2
           AND checkpoint."namespace" = $3
           AND (
             checkpoint."checkpoint_key" = $4
             OR checkpoint."idempotency_key" = $5
           )
         FOR UPDATE OF checkpoint`,
        [
          input.lease.workspaceId,
          input.lease.runId,
          input.namespace,
          input.adapterCheckpointKey,
          input.idempotencyKey,
        ],
      )) as CheckpointRow[];
      if (existingRows.length > 1) throw invalidStore();
      if (existingRows.length === 1) {
        const existing = await this.readCheckpoint(manager, existingRows[0]!);
        assertSameCheckpoint(existing, input);
        return existing;
      }

      const latestRows = (await manager.query(
        `SELECT COALESCE(MAX("sequence"), 0) AS "sequence"
         FROM "runtime_checkpoints"
         WHERE "workspace_id" = $1
           AND "run_id" = $2`,
        [input.lease.workspaceId, input.lease.runId],
      )) as Array<{ sequence: unknown }>;
      if (latestRows.length !== 1) throw invalidStore();
      const latestSequence = nonNegativeSequence(latestRows[0]!.sequence);

      const parent = await this.resolveParent(manager, input);
      const sequence = latestSequence + 1;
      const checkpointId = randomUUID();
      const inserted = (await manager.query(
        `INSERT INTO "runtime_checkpoints" (
           "id", "workspace_id", "run_id", "namespace", "checkpoint_key",
           "parent_checkpoint_id", "sequence", "lease_generation",
           "schema_version", "idempotency_key", "state_digest",
           "adapter_state"
         ) VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
         )
         RETURNING
           "id" AS "checkpoint_id",
           "workspace_id", "run_id", "namespace", "checkpoint_key",
           "parent_checkpoint_id", "sequence", "lease_generation",
           "schema_version", "state_digest", "adapter_state"`,
        [
          checkpointId,
          input.lease.workspaceId,
          input.lease.runId,
          input.namespace,
          input.adapterCheckpointKey,
          parent?.checkpointId ?? null,
          sequence,
          input.lease.fencingGeneration,
          RUNTIME_CHECKPOINT_SCHEMA_VERSION,
          input.idempotencyKey,
          input.stateDigest,
          JSON.stringify(input.adapterState),
        ],
      )) as CheckpointRow[];
      if (inserted.length !== 1) throw invalidStore();

      await appendCheckpointCreatedEvent(manager, {
        checkpointId,
        checkpointSequence: sequence,
        lease: input.lease,
        leaseToken: input.lease.leaseToken,
      });

      return createGraphCheckpointEnvelope({
        adapter: input.adapter,
        adapterCheckpointKey: input.adapterCheckpointKey,
        checkpointId,
        lineage: input.lineage,
        namespace: input.namespace,
        parentCheckpointKey: input.parentCheckpointKey,
        runId: input.lease.runId,
        sequence,
        state: input.adapterState.state,
        workspaceId: input.lease.workspaceId,
      });
    });
  }

  async loadPendingWrites(
    request: LoadRuntimeCheckpointPendingWritesRequest,
  ): Promise<RuntimeCheckpointPendingWritesEnvelope> {
    const scope = this.readScope(request);
    const reference = readReference(request.checkpoint);
    const checkpoint = await this.load({
      adapterCheckpointKey: reference.adapterCheckpointKey,
      namespace: reference.namespace,
      runId: scope.runId,
      workspaceId: scope.workspaceId,
    });
    assertReference(checkpoint, reference);
    const writes = await loadPendingWrites(
      this.dataSource,
      scope.workspaceId,
      scope.runId,
      reference.checkpointId,
    );
    return createRuntimeCheckpointPendingWritesEnvelope({
      checkpoint: reference,
      runId: scope.runId,
      workspaceId: scope.workspaceId,
      writes,
    });
  }

  async savePendingWrites(
    request: SaveRuntimeCheckpointPendingWritesRequest,
  ): Promise<RuntimeCheckpointPendingWritesEnvelope> {
    const lease = this.readLease(request.lease);
    const reference = readReference(request.checkpoint);
    const proposed = normalizePendingWrites(request.writes);

    return this.dataSource.transaction(async (manager) => {
      await this.lockActiveLease(manager, lease);
      const checkpointRows = (await manager.query(
        `${CHECKPOINT_SELECT}
         WHERE checkpoint."workspace_id" = $1
           AND checkpoint."run_id" = $2
           AND checkpoint."id" = $3
           AND checkpoint."namespace" = $4
           AND checkpoint."checkpoint_key" = $5
           AND checkpoint."sequence" = $6
         FOR UPDATE OF checkpoint`,
        [
          lease.workspaceId,
          lease.runId,
          reference.checkpointId,
          reference.namespace,
          reference.adapterCheckpointKey,
          reference.sequence,
        ],
      )) as CheckpointRow[];
      const checkpoint = await this.readSingleCheckpoint(
        manager,
        checkpointRows,
        true,
      );
      assertReference(checkpoint, reference);

      const existing = await loadPendingWrites(
        manager,
        lease.workspaceId,
        lease.runId,
        reference.checkpointId,
      );
      const existingByKey = pendingWritesByKey(existing);
      const novel: RuntimeCheckpointPendingWrite[] = [];
      const replacements: RuntimeCheckpointPendingWrite[] = [];
      for (const write of proposed) {
        const saved = existingByKey.get(pendingWriteKey(write));
        if (!saved) novel.push(write);
        else if (samePendingWrite(saved, write)) continue;
        else if (write.index >= 0 || saved.channel !== write.channel) {
          throw conflictStore();
        } else replacements.push(write);
      }

      for (const write of replacements) {
        const rows = (await manager.query(
          `UPDATE "runtime_checkpoint_writes"
           SET
             "type" = $7,
             "value" = $8::jsonb,
             "updated_at" = clock_timestamp()
           WHERE "workspace_id" = $1
             AND "run_id" = $2
             AND "checkpoint_id" = $3
             AND "task_id" = $4
             AND "write_index" = $5
             AND "write_index" < 0
             AND "channel" = $6
           RETURNING "id"`,
          [
            lease.workspaceId,
            lease.runId,
            reference.checkpointId,
            write.taskId,
            write.index,
            write.channel,
            write.type,
            JSON.stringify(write.value),
          ],
        )) as Array<{ id: unknown }>;
        if (rows.length !== 1) throw conflictStore();
      }

      for (const write of novel) {
        const rows = (await manager.query(
          `INSERT INTO "runtime_checkpoint_writes" (
             "id", "workspace_id", "run_id", "checkpoint_id", "task_id",
             "write_index", "channel", "type", "value"
           ) VALUES (
             uuid_generate_v4(), $1, $2, $3, $4, $5, $6, $7, $8::jsonb
           )
           RETURNING "id"`,
          [
            lease.workspaceId,
            lease.runId,
            reference.checkpointId,
            write.taskId,
            write.index,
            write.channel,
            write.type,
            JSON.stringify(write.value),
          ],
        )) as Array<{ id: unknown }>;
        if (rows.length !== 1) throw invalidStore();
      }

      return createRuntimeCheckpointPendingWritesEnvelope({
        checkpoint: reference,
        runId: lease.runId,
        workspaceId: lease.workspaceId,
        writes: mergePendingWrites(existing, proposed),
      });
    });
  }

  private readScope(request: {
    namespace?: unknown;
    runId: unknown;
    workspaceId: unknown;
  }) {
    const workspaceId = uuid(request.workspaceId);
    const runId = uuid(request.runId);
    const namespace = normalizeRuntimeCheckpointNamespace(
      request.namespace ?? "",
    );
    const context = this.trustedContext.current(false);
    if (!context) throw staleLease();
    if (
      context.lease.workspaceId !== workspaceId ||
      context.lease.runId !== runId
    ) {
      throw staleLease();
    }
    return Object.freeze({ namespace, runId, workspaceId });
  }

  private readLease(value: SaveGraphCheckpointRequest["lease"]) {
    const lease = Object.freeze({
      fencingGeneration: parseRuntimeCheckpointLeaseGeneration(
        value?.fencingGeneration,
      ),
      runId: uuid(value?.runId),
      workspaceId: uuid(value?.workspaceId),
    });
    const context = this.trustedContext.current(false);
    if (!context) throw staleLease();
    if (
      context.lease.workspaceId !== lease.workspaceId ||
      context.lease.runId !== lease.runId ||
      context.lease.fencingGeneration !== lease.fencingGeneration
    ) {
      throw staleLease();
    }
    return Object.freeze({ ...lease, leaseToken: uuid(context.leaseToken) });
  }

  private readSaveRequest(request: SaveGraphCheckpointRequest) {
    const lease = this.readLease(request.lease);
    const namespace = normalizeRuntimeCheckpointNamespace(request.namespace);
    const adapterCheckpointKey = checkpointKey(
      request.adapterCheckpointKey,
    );
    const parentCheckpointKey =
      request.parentCheckpointKey === null
        ? null
        : checkpointKey(request.parentCheckpointKey);
    const lineage = normalizeLineage(
      request.lineage,
      parentCheckpointKey,
      adapterCheckpointKey,
    );
    const adapter = readAdapter(request.adapter);
    const adapterState = createRuntimeCheckpointAdapterStateEnvelope({
      adapter,
      state: request.state,
    });
    const idempotencyKey = normalizeRuntimeCheckpointIdempotencyKey(
      `checkpoint:${adapterCheckpointKey}`,
    );
    const stateDigest = normalizeRuntimeCheckpointStateDigest(
      createHash("sha256")
        .update(canonicalJson(adapterState))
        .digest("hex"),
    );
    return Object.freeze({
      adapterCheckpointKey,
      adapter,
      adapterState,
      idempotencyKey,
      lease,
      lineage,
      namespace,
      parentCheckpointKey,
      stateDigest,
    });
  }

  private async lockActiveLease(
    manager: EntityManager,
    lease: Readonly<{
      fencingGeneration: number;
      leaseToken: string;
      runId: string;
      workspaceId: string;
    }>,
  ) {
    const rows = (await manager.query(
      `SELECT "id"
       FROM "runtime_runs"
       WHERE "workspace_id" = $1
         AND "id" = $2
         AND "lease_token" = $3
         AND "lease_generation" = $4
         AND "status" = 'running'
         AND "cancellation_requested_at" IS NULL
         AND "lease_expires_at" > clock_timestamp()
       FOR UPDATE`,
      [
        lease.workspaceId,
        lease.runId,
        lease.leaseToken,
        lease.fencingGeneration,
      ],
    )) as Array<{ id: unknown }>;
    if (rows.length !== 1 || uuid(rows[0]!.id) !== lease.runId) {
      throw staleLease();
    }
  }

  private async resolveParent(
    manager: EntityManager,
    input: ReturnType<TypeOrmRuntimeCheckpointStore["readSaveRequest"]>,
  ) {
    if (input.parentCheckpointKey === null) {
      if (input.lineage.length !== 0) throw conflictStore();
      return null;
    }
    const rows = (await manager.query(
      `${CHECKPOINT_SELECT}
       WHERE checkpoint."workspace_id" = $1
         AND checkpoint."run_id" = $2
         AND checkpoint."namespace" = $3
         AND checkpoint."checkpoint_key" = $4`,
      [
        input.lease.workspaceId,
        input.lease.runId,
        input.namespace,
        input.parentCheckpointKey,
      ],
    )) as CheckpointRow[];
    const parent = await this.readSingleCheckpoint(manager, rows, true);
    if (!parent) throw conflictStore();
    const expectedLineage = Object.freeze([
      ...parent.lineage,
      parent.adapterCheckpointKey,
    ]);
    if (!sameStrings(expectedLineage, input.lineage)) throw conflictStore();
    return parent;
  }

  private async readSingleCheckpoint(
    executor: QueryExecutor,
    rows: CheckpointRow[],
    required: boolean,
  ) {
    if (rows.length === 0) {
      if (required) throw invalidStore();
      return null;
    }
    if (rows.length !== 1) throw invalidStore();
    return this.readCheckpoint(executor, rows[0]!);
  }

  private async readCheckpoint(
    executor: QueryExecutor,
    row: CheckpointRow,
  ): Promise<GraphCheckpointEnvelope> {
    const checkpointId = uuid(row.checkpoint_id);
    if (row.schema_version !== RUNTIME_CHECKPOINT_SCHEMA_VERSION) {
      throw invalidStore();
    }
    parseRuntimeCheckpointLeaseGeneration(row.lease_generation);
    const stateDigest = normalizeRuntimeCheckpointStateDigest(row.state_digest);
    const adapterState = parseRuntimeCheckpointAdapterStateEnvelope(
      row.adapter_state,
    );
    const actualDigest = createHash("sha256")
      .update(canonicalJson(adapterState))
      .digest("hex");
    if (actualDigest !== stateDigest) throw invalidStore();
    const parentCheckpointKey =
      row.parent_checkpoint_key === null
        ? null
        : checkpointKey(row.parent_checkpoint_key);
    const lineage = await loadLineage(
      executor,
      uuid(row.workspace_id),
      uuid(row.run_id),
      checkpointId,
    );
    return createGraphCheckpointEnvelope({
      adapter: readAdapter(adapterState.adapter),
      adapterCheckpointKey: checkpointKey(row.checkpoint_key),
      checkpointId,
      lineage,
      namespace: normalizeRuntimeCheckpointNamespace(row.namespace),
      parentCheckpointKey,
      runId: uuid(row.run_id),
      sequence: parseRuntimeCheckpointSequence(row.sequence),
      state: adapterState.state,
      workspaceId: uuid(row.workspace_id),
    });
  }
}

const CHECKPOINT_SELECT = `
  SELECT
    checkpoint."id" AS "checkpoint_id",
    checkpoint."workspace_id",
    checkpoint."run_id",
    checkpoint."namespace",
    checkpoint."checkpoint_key",
    checkpoint."parent_checkpoint_id",
    parent."checkpoint_key" AS "parent_checkpoint_key",
    checkpoint."sequence",
    checkpoint."lease_generation",
    checkpoint."schema_version",
    checkpoint."state_digest",
    checkpoint."adapter_state"
  FROM "runtime_checkpoints" AS checkpoint
  LEFT JOIN "runtime_checkpoints" AS parent
    ON parent."workspace_id" = checkpoint."workspace_id"
    AND parent."run_id" = checkpoint."run_id"
    AND parent."id" = checkpoint."parent_checkpoint_id"
`;

async function loadLineage(
  executor: QueryExecutor,
  workspaceId: string,
  runId: string,
  checkpointId: string,
) {
  const rows = (await executor.query(
    `WITH RECURSIVE ancestors AS (
       SELECT
         parent."id",
         parent."parent_checkpoint_id",
         parent."checkpoint_key",
         1 AS "depth"
       FROM "runtime_checkpoints" AS child
       INNER JOIN "runtime_checkpoints" AS parent
         ON parent."workspace_id" = child."workspace_id"
         AND parent."run_id" = child."run_id"
         AND parent."id" = child."parent_checkpoint_id"
       WHERE child."workspace_id" = $1
         AND child."run_id" = $2
         AND child."id" = $3
       UNION ALL
       SELECT
         parent."id",
         parent."parent_checkpoint_id",
         parent."checkpoint_key",
         ancestors."depth" + 1
       FROM ancestors
       INNER JOIN "runtime_checkpoints" AS parent
         ON parent."workspace_id" = $1
         AND parent."run_id" = $2
         AND parent."id" = ancestors."parent_checkpoint_id"
     )
     SELECT "checkpoint_key"
     FROM ancestors
     ORDER BY "depth" DESC`,
    [workspaceId, runId, checkpointId],
  )) as Array<{ checkpoint_key: unknown }>;
  return Object.freeze(rows.map((row) => checkpointKey(row.checkpoint_key)));
}

async function loadPendingWrites(
  executor: QueryExecutor,
  workspaceId: string,
  runId: string,
  checkpointId: string,
) {
  const rows = (await executor.query(
    `SELECT "task_id", "write_index", "channel", "type", "value"
     FROM "runtime_checkpoint_writes"
     WHERE "workspace_id" = $1
       AND "run_id" = $2
       AND "checkpoint_id" = $3
     ORDER BY "task_id" ASC, "write_index" ASC`,
    [workspaceId, runId, checkpointId],
  )) as CheckpointWriteRow[];
  return Object.freeze(
    rows.map((row) =>
      createRuntimeCheckpointPendingWrite({
        channel: row.channel,
        index: row.write_index,
        taskId: row.task_id,
        type: row.type,
        value: row.value,
      }),
    ),
  );
}

async function appendCheckpointCreatedEvent(
  manager: EntityManager,
  input: {
    checkpointId: string;
    checkpointSequence: number;
    lease: Readonly<{
      fencingGeneration: number;
      runId: string;
      workspaceId: string;
    }>;
    leaseToken: string;
  },
) {
  const rows = (await manager.query(
    `WITH database_clock AS MATERIALIZED (
       SELECT clock_timestamp() AS "now"
     ), advanced_run AS (
       UPDATE "runtime_runs" AS runtime_run
       SET
         "event_sequence" = runtime_run."event_sequence" + 1,
         "updated_at" = database_clock."now"
       FROM database_clock
       WHERE runtime_run."workspace_id" = $1
         AND runtime_run."id" = $2
         AND runtime_run."lease_token" = $3
         AND runtime_run."lease_generation" = $4
         AND runtime_run."status" = 'running'
         AND runtime_run."cancellation_requested_at" IS NULL
         AND runtime_run."lease_expires_at" > database_clock."now"
       RETURNING runtime_run."event_sequence"
     )
     INSERT INTO "runtime_run_events" (
       "id", "created_at", "updated_at", "workspace_id", "run_id",
       "sequence", "schema_version", "event_key", "type", "node_id",
       "call_id", "occurred_at", "payload"
     )
     SELECT
       uuid_generate_v4(), database_clock."now", database_clock."now",
       $1::uuid, $2::uuid, advanced_run."event_sequence", $5,
       $6, $7, NULL, NULL, database_clock."now",
       jsonb_build_object(
         'checkpointId', $8::uuid,
         'checkpointSequence', $9::integer
       )
     FROM advanced_run
     CROSS JOIN database_clock
     RETURNING "id"`,
    [
      input.lease.workspaceId,
      input.lease.runId,
      input.leaseToken,
      input.lease.fencingGeneration,
      RUNTIME_RUN_EVENT_SCHEMA_VERSION,
      `${CHECKPOINT_CREATED_EVENT_TYPE}:${input.checkpointId}`,
      CHECKPOINT_CREATED_EVENT_TYPE,
      input.checkpointId,
      input.checkpointSequence,
    ],
  )) as Array<{ id: unknown }>;
  if (rows.length !== 1) throw staleLease();
}

function normalizePendingWrites(value: unknown) {
  if (!Array.isArray(value)) throw invalidStore();
  const byKey = new Map<string, RuntimeCheckpointPendingWrite>();
  for (const item of value) {
    if (!isRecord(item)) throw invalidStore();
    const write = createRuntimeCheckpointPendingWrite({
      channel: item.channel,
      index: item.index,
      taskId: item.taskId,
      type: item.type,
      value: item.value,
    });
    const previous = byKey.get(pendingWriteKey(write));
    if (previous && !samePendingWrite(previous, write)) throw conflictStore();
    byKey.set(pendingWriteKey(write), write);
  }
  return Object.freeze([...byKey.values()]);
}

function readReference(value: GraphCheckpointReference) {
  if (!isRecord(value)) throw invalidStore();
  return Object.freeze({
    adapterCheckpointKey: checkpointKey(value.adapterCheckpointKey),
    checkpointId: uuid(value.checkpointId),
    namespace: normalizeRuntimeCheckpointNamespace(value.namespace),
    sequence: parseRuntimeCheckpointSequence(value.sequence),
  });
}

function assertReference(
  checkpoint: GraphCheckpointEnvelope | null,
  reference: GraphCheckpointReference,
) {
  if (
    !checkpoint ||
    checkpoint.checkpointId !== reference.checkpointId ||
    checkpoint.sequence !== reference.sequence ||
    checkpoint.namespace !== reference.namespace ||
    checkpoint.adapterCheckpointKey !== reference.adapterCheckpointKey
  ) {
    throw invalidStore();
  }
}

function assertSameCheckpoint(
  checkpoint: GraphCheckpointEnvelope,
  input: Readonly<{
    adapterCheckpointKey: string;
    adapterState: RuntimeCheckpointAdapterStateEnvelope;
    lineage: readonly string[];
    namespace: string;
    parentCheckpointKey: string | null;
    stateDigest: string;
  }>,
) {
  const digest = createHash("sha256")
    .update(
      canonicalJson({
        adapter: checkpoint.adapter,
        state: checkpoint.state,
      }),
    )
    .digest("hex");
  if (
    checkpoint.adapterCheckpointKey !== input.adapterCheckpointKey ||
    checkpoint.namespace !== input.namespace ||
    checkpoint.parentCheckpointKey !== input.parentCheckpointKey ||
    !sameStrings(checkpoint.lineage, input.lineage) ||
    digest !== input.stateDigest ||
    canonicalJson(checkpoint.adapter) !==
      canonicalJson(input.adapterState.adapter) ||
    canonicalJson(checkpoint.state) !== canonicalJson(input.adapterState.state)
  ) {
    throw conflictStore();
  }
}

function normalizeLineage(
  value: unknown,
  parentCheckpointKey: string | null,
  adapterCheckpointKey: string,
) {
  if (!Array.isArray(value)) throw invalidStore();
  const lineage = value.map(checkpointKey);
  if (
    new Set(lineage).size !== lineage.length ||
    lineage.includes(adapterCheckpointKey) ||
    (parentCheckpointKey === null && lineage.length !== 0) ||
    (parentCheckpointKey !== null && lineage.at(-1) !== parentCheckpointKey)
  ) {
    throw invalidStore();
  }
  return Object.freeze(lineage);
}

function pendingWritesByKey(
  writes: readonly RuntimeCheckpointPendingWrite[],
) {
  return new Map(writes.map((write) => [pendingWriteKey(write), write]));
}

function mergePendingWrites(
  existing: readonly RuntimeCheckpointPendingWrite[],
  proposed: readonly RuntimeCheckpointPendingWrite[],
) {
  const merged = pendingWritesByKey(existing);
  for (const write of proposed) merged.set(pendingWriteKey(write), write);
  return Object.freeze(
    [...merged.values()].sort(
      (left, right) =>
        left.taskId.localeCompare(right.taskId) || left.index - right.index,
    ),
  );
}

function pendingWriteKey(write: RuntimeCheckpointPendingWrite) {
  return `${write.taskId}\u0000${write.index}`;
}

function samePendingWrite(
  left: RuntimeCheckpointPendingWrite,
  right: RuntimeCheckpointPendingWrite,
) {
  return (
    left.taskId === right.taskId &&
    left.index === right.index &&
    left.channel === right.channel &&
    left.type === right.type &&
    canonicalJson(left.value) === canonicalJson(right.value)
  );
}

function canonicalJson(value: HermesJsonValue | object): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, HermesJsonValue>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key]!)}`)
    .join(",")}}`;
}

function sameStrings(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function checkpointKey(value: unknown) {
  try {
    return normalizeRuntimeCheckpointAdapterKey(value);
  } catch {
    throw invalidStore();
  }
}

function readAdapter(value: unknown): GraphExecutionAdapterDescriptor {
  if (
    !isRecord(value) ||
    typeof value.kind !== "string" ||
    value.kind.length > 128 ||
    !/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value.kind) ||
    typeof value.checkpointVersion !== "string" ||
    value.checkpointVersion.length < 1 ||
    value.checkpointVersion.length > 128 ||
    !/^[A-Za-z0-9][A-Za-z0-9./:_-]*$/.test(value.checkpointVersion)
  ) {
    throw invalidStore();
  }
  return Object.freeze({
    checkpointVersion: value.checkpointVersion,
    kind: value.kind as GraphExecutionAdapterDescriptor["kind"],
  });
}

function uuid(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw invalidStore();
  }
  return value.toLowerCase();
}

function listLimit(value: unknown) {
  if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > MAX_LIST_LIMIT) {
    throw invalidStore();
  }
  return Number(value);
}

function nonNegativeSequence(value: unknown) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0 || number > 2_147_483_647) {
    throw invalidStore();
  }
  return number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function staleLease() {
  return new RuntimeCheckpointStoreError(
    RUNTIME_CHECKPOINT_STORE_ERROR_CODES.staleLease,
  );
}

function conflictStore() {
  return new RuntimeCheckpointStoreError(
    RUNTIME_CHECKPOINT_STORE_ERROR_CODES.conflict,
  );
}

function invalidStore() {
  return new RuntimeCheckpointStoreError(
    RUNTIME_CHECKPOINT_STORE_ERROR_CODES.invalid,
  );
}

function messageFor(code: RuntimeCheckpointStoreErrorCode) {
  switch (code) {
    case RUNTIME_CHECKPOINT_STORE_ERROR_CODES.conflict:
      return "Runtime checkpoint conflicts with durable state.";
    case RUNTIME_CHECKPOINT_STORE_ERROR_CODES.invalid:
      return "Runtime checkpoint storage invariant failed.";
    case RUNTIME_CHECKPOINT_STORE_ERROR_CODES.staleLease:
      return "Runtime checkpoint lease is stale.";
  }
}
