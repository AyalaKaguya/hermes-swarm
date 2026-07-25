import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { createRuntimeDispatchEnvelope } from "@hermes-swarm/agent-sdk";
import {
  RUNTIME_DISPATCH_SCHEMA_VERSION,
  RUNTIME_DISPATCH_TOPIC,
  RUNTIME_RUN_SCHEMA_VERSION,
  RuntimeOutboxMessage,
  RuntimeRun,
  appendRuntimeRunStatusChanges,
} from "@hermes-swarm/core";
import type { EntityManager } from "typeorm";
import { WorkspaceContextService } from "../database/workspace-context.service.js";
import {
  DEFAULT_RUNTIME_OUTBOX_MAX_ATTEMPTS,
  DEFAULT_RUNTIME_RUN_MAX_ATTEMPTS,
  RuntimeCancellationNotFoundError,
  RuntimeSubmissionConflictError,
  RuntimeSubmissionInvariantError,
  type RuntimeSubmissionInput,
  type RuntimeSubmissionResult,
  RuntimeSubmissionValidationError,
} from "./runtime-submission.types.js";

const RUNTIME_SUBMISSION_INPUT_KEYS = new Set([
  "availableAt",
  "correlationId",
  "deadlineAt",
  "idempotencyKey",
  "maxAttempts",
  "requestDigest",
  "runKind",
]);
const TERMINAL_RUNTIME_RUN_STATUSES = new Set<RuntimeRun["status"]>([
  "cancelled",
  "failed",
  "succeeded",
  "timedOut",
]);

@Injectable()
export class RuntimeSubmissionService {
  constructor(private readonly workspaceContext: WorkspaceContextService) {}

  /**
   * Persists a run and its dispatch intent on the caller's active transaction.
   * This method deliberately neither opens a transaction nor contacts Redis.
   */
  async submitInTransaction(
    manager: EntityManager,
    input: RuntimeSubmissionInput,
  ): Promise<RuntimeSubmissionResult> {
    requireActiveTransaction(manager);
    const workspaceId = requireWorkspaceId(
      this.workspaceContext.current(false)?.workspaceId,
    );
    const submission = normalizeSubmission(input);
    await requireReadCommittedIsolation(manager);
    const runRepository = manager.getRepository(RuntimeRun);
    const outboxRepository = manager.getRepository(RuntimeOutboxMessage);

    await manager.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      [
        `runtime-submission:${workspaceId}`,
        `${submission.runKind}:${submission.idempotencyKey}`,
      ],
    );

    const existingRun = await runRepository.findOne({
      where: {
        idempotencyKey: submission.idempotencyKey,
        runKind: submission.runKind,
        workspaceId,
      },
    });
    if (existingRun) {
      if (existingRun.requestDigest !== submission.requestDigest) {
        throw new RuntimeSubmissionConflictError();
      }
      const existingOutbox = await outboxRepository.findOne({
        where: {
          runId: existingRun.id,
          topic: RUNTIME_DISPATCH_TOPIC,
          workspaceId,
        },
      });
      if (!existingOutbox) throw new RuntimeSubmissionInvariantError();
      return {
        deduplicated: true,
        outbox: existingOutbox,
        run: existingRun,
      };
    }

    const runId = randomUUID();
    const dispatchId = randomUUID();
    const run = await runRepository.save(
      runRepository.create({
        attemptCount: 0,
        availableAt: submission.availableAt,
        cancellationRequestedAt: null,
        correlationId: submission.correlationId,
        deadlineAt: submission.deadlineAt,
        eventSequence: 0,
        finishedAt: null,
        heartbeatAt: null,
        id: runId,
        idempotencyKey: submission.idempotencyKey,
        lastErrorCode: null,
        leaseExpiresAt: null,
        leaseGeneration: 0,
        leaseOwner: null,
        leaseToken: null,
        maxAttempts: submission.maxAttempts,
        requestDigest: submission.requestDigest,
        runKind: submission.runKind,
        schemaVersion: RUNTIME_RUN_SCHEMA_VERSION,
        startedAt: null,
        status: "queued",
        workspaceId,
      }),
    );
    const envelope = createRuntimeDispatchEnvelope({
      dispatchId,
      runId: run.id,
    });
    const outbox = await outboxRepository.save(
      outboxRepository.create({
        attemptCount: 0,
        availableAt: submission.availableAt,
        dedupeKey: `${RUNTIME_DISPATCH_TOPIC}:${run.id}`,
        id: dispatchId,
        lastErrorCode: null,
        leaseExpiresAt: null,
        leaseOwner: null,
        leaseToken: null,
        maxAttempts: DEFAULT_RUNTIME_OUTBOX_MAX_ATTEMPTS,
        payload: envelope,
        publishedAt: null,
        runId: run.id,
        schemaVersion: RUNTIME_DISPATCH_SCHEMA_VERSION,
        status: "pending",
        topic: RUNTIME_DISPATCH_TOPIC,
        workspaceId,
      }),
    );

    return { deduplicated: false, outbox, run };
  }

  /**
   * Requests cancellation while holding the run row in the caller's active
   * transaction. The current workspace is always part of the lookup so an
   * unknown run and a run owned by another workspace are indistinguishable.
   */
  async requestCancellationInTransaction(
    manager: EntityManager,
    runId: string,
  ): Promise<RuntimeRun> {
    requireActiveTransaction(manager);
    const workspaceId = requireWorkspaceId(
      this.workspaceContext.current(false)?.workspaceId,
    );
    const normalizedRunId = requireWorkspaceId(runId);
    const runRepository = manager.getRepository(RuntimeRun);
    const run = await runRepository.findOne({
      lock: { mode: "pessimistic_write" },
      where: { id: normalizedRunId, workspaceId },
    });

    if (!run) throw new RuntimeCancellationNotFoundError();
    if (TERMINAL_RUNTIME_RUN_STATUSES.has(run.status)) return run;
    if (run.status === "cancelling" && run.cancellationRequestedAt !== null) {
      return run;
    }
    if (
      run.status !== "queued" &&
      run.status !== "waiting" &&
      run.status !== "running" &&
      run.status !== "cancelling"
    ) {
      throw new RuntimeSubmissionInvariantError();
    }

    const requestedAt = await readDatabaseClock(manager);
    const previousStatus = run.status;
    run.cancellationRequestedAt ??= requestedAt;
    if (run.status === "queued" || run.status === "waiting") {
      run.status = "cancelled";
      run.finishedAt = requestedAt;
      run.lastErrorCode = null;
      run.leaseToken = null;
      run.leaseOwner = null;
      run.leaseExpiresAt = null;
      run.heartbeatAt = null;
    } else {
      run.status = "cancelling";
    }
    const savedRun = await runRepository.save(run);
    const events = await appendRuntimeRunStatusChanges(manager, [
      {
        from: previousStatus,
        reasonCode: "user",
        runId: savedRun.id,
        to: savedRun.status,
        workspaceId,
      },
    ]);
    const statusEvent = events[0];
    if (statusEvent) savedRun.eventSequence = statusEvent.sequence;
    return savedRun;
  }
}

type NormalizedSubmission = {
  availableAt: Date;
  correlationId: string | null;
  deadlineAt: Date | null;
  idempotencyKey: string;
  maxAttempts: number;
  requestDigest: string;
  runKind: string;
};

function normalizeSubmission(input: RuntimeSubmissionInput): NormalizedSubmission {
  if (!isPlainRecord(input)) throw new RuntimeSubmissionValidationError();
  if (
    Reflect.ownKeys(input).some(
      (key) => typeof key !== "string" || !RUNTIME_SUBMISSION_INPUT_KEYS.has(key),
    )
  ) {
    throw new RuntimeSubmissionValidationError();
  }
  const runKind = requireMatchingText(
    input.runKind,
    /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/,
  );
  if (runKind.length > 128) throw new RuntimeSubmissionValidationError();
  const idempotencyKey = requireMatchingText(
    input.idempotencyKey,
    /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/,
  );
  const requestDigest = requireMatchingText(
    input.requestDigest,
    /^[a-f0-9]{64}$/,
  );
  const correlationId =
    input.correlationId === undefined || input.correlationId === null
      ? null
      : requireMatchingText(
          input.correlationId,
          /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/,
        );
  const maxAttempts = input.maxAttempts ?? DEFAULT_RUNTIME_RUN_MAX_ATTEMPTS;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 100) {
    throw new RuntimeSubmissionValidationError();
  }
  const availableAt = cloneValidDate(input.availableAt ?? new Date());
  const deadlineAt =
    input.deadlineAt === undefined || input.deadlineAt === null
      ? null
      : cloneValidDate(input.deadlineAt);
  if (deadlineAt && deadlineAt.getTime() <= availableAt.getTime()) {
    throw new RuntimeSubmissionValidationError();
  }
  return {
    availableAt,
    correlationId,
    deadlineAt,
    idempotencyKey,
    maxAttempts,
    requestDigest,
    runKind,
  };
}

function requireActiveTransaction(manager: EntityManager) {
  if (
    !manager ||
    typeof manager.getRepository !== "function" ||
    typeof manager.query !== "function" ||
    manager.queryRunner?.isTransactionActive !== true
  ) {
    throw new RuntimeSubmissionValidationError();
  }
}

async function requireReadCommittedIsolation(manager: EntityManager) {
  const rows = (await manager.query(
    "SHOW transaction_isolation",
  )) as Array<{ transaction_isolation?: unknown }>;
  const isolationLevel = rows[0]?.transaction_isolation;
  if (
    rows.length !== 1 ||
    typeof isolationLevel !== "string" ||
    isolationLevel.trim().toLowerCase() !== "read committed"
  ) {
    throw new RuntimeSubmissionValidationError();
  }
}

async function readDatabaseClock(manager: EntityManager) {
  const rows = (await manager.query(
    `SELECT clock_timestamp() AS "databaseNow"`,
  )) as Array<{ databaseNow?: unknown }>;
  if (rows.length !== 1) throw new RuntimeSubmissionInvariantError();
  const value = rows[0]?.databaseNow;
  const timestamp =
    value instanceof Date ? new Date(value.getTime()) : new Date(String(value));
  if (!Number.isFinite(timestamp.getTime())) {
    throw new RuntimeSubmissionInvariantError();
  }
  return timestamp;
}

function requireWorkspaceId(value: unknown) {
  if (
    typeof value !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    )
  ) {
    throw new RuntimeSubmissionValidationError();
  }
  return value.toLowerCase();
}

function requireMatchingText(value: unknown, pattern: RegExp) {
  if (typeof value !== "string" || value !== value.trim() || !pattern.test(value)) {
    throw new RuntimeSubmissionValidationError();
  }
  return value;
}

function cloneValidDate(value: unknown) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new RuntimeSubmissionValidationError();
  }
  return new Date(value.getTime());
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
