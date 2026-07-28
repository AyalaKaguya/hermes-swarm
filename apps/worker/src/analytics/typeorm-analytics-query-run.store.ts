import { randomUUID } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import type { RunHandlerContext } from "@hermes-swarm/agent-sdk";
import {
  AnalysisQueryRun,
  DatasetArtifact,
  FileObject,
  RuntimeRun,
} from "@hermes-swarm/core";
import {
  ANALYSIS_QUERY_RUN_SCHEMA_VERSION,
  DATASET_ARTIFACT_SCHEMA_VERSION,
  analyticsDigest,
  parseAnalysisQuery,
} from "@hermes-swarm/core/analytics";
import { DataSource, type EntityManager } from "typeorm";
import type { WorkerRuntimeConfig } from "../config/worker-runtime.config.js";
import { TrustedRunContextService } from "../runtime/trusted-run-context.service.js";
import type {
  AnalyticsArtifactCandidate,
  AnalyticsArtifactReservation,
  AnalyticsQueryRunStore,
  AuthorizedAnalysisQueryRun,
  PreparedAnalysisQueryRun,
} from "./analytics-query-run.types.js";
import { AnalyticsQueryRunHandlerError } from "./analytics-query-run.types.js";

const SUPPORT_TICKETS_SOURCE_KEY = "support.tickets";
const SUPPORT_TICKETS_SOURCE_REVISION = "support.tickets/v1";
const SUPPORT_TICKETS_POLICY_REVISION = "support.tickets-policy:v1";
const SUPPORT_TICKETS_QUERY_PERMISSION =
  "analytics.ticket_dataset.query:workspace";
const SUPPORT_TICKETS_QUERY_RUN_SUBMIT_PERMISSION =
  "analytics.ticket_dataset.query_run_submit:workspace";
const REQUIRED_EXECUTION_PERMISSIONS = Object.freeze([
  SUPPORT_TICKETS_QUERY_PERMISSION,
  SUPPORT_TICKETS_QUERY_RUN_SUBMIT_PERMISSION,
]);
const ANALYTICS_FEATURE_KEY = "feature:analytics:enabled";
const ARTIFACT_CREATED_EVENT_TYPE = "artifact.created";
const RUNTIME_RUN_EVENT_SCHEMA_VERSION = "hermes.run-event/v1";
const SUPERSEDED_ARTIFACT_FILE_FAILURE_CODE =
  "ANALYTICS_ARTIFACT_SUPERSEDED";

type AuthorizationRow = {
  allowed: boolean;
  feature_enabled: string;
  preferred_language: string | null;
  time_zone: string | null;
};

type TokenAuthorizationRow = { allowed: boolean };

@Injectable()
export class TypeOrmAnalyticsQueryRunStore implements AnalyticsQueryRunStore {
  private readonly pendingFileTtlMs: number;

  constructor(
    private readonly dataSource: DataSource,
    private readonly trustedContext: TrustedRunContextService,
    configService: ConfigService,
  ) {
    this.pendingFileTtlMs =
      configService.getOrThrow<WorkerRuntimeConfig>("worker").objectStorage
        .pendingTtlSeconds * 1_000;
  }

  hasRemainingAttempts(context: RunHandlerContext) {
    const trusted = this.requireTrusted(context);
    return trusted.attempt < trusted.maxAttempts;
  }

  async prepare(context: RunHandlerContext): Promise<PreparedAnalysisQueryRun> {
    const trusted = this.requireTrusted(context);
    return this.dataSource.transaction(async (manager) => {
      const runtimeRun = await this.lockRuntimeRun(manager, trusted);
      const queryRun = await manager.findOne(AnalysisQueryRun, {
        lock: { mode: "pessimistic_write" },
        where: {
          id: trusted.lease.runId,
          workspaceId: trusted.lease.workspaceId,
        },
      });
      const clock = await databaseClock(manager);
      assertActiveRuntimeRun(runtimeRun, trusted, clock, false);
      if (!queryRun || queryRun.schemaVersion !== ANALYSIS_QUERY_RUN_SCHEMA_VERSION) {
        throw fatal("ANALYTICS_QUERY_RUN_INVALID", "Analytics query run is invalid.");
      }
      if (queryRun.expiresAt <= clock) {
        throw fatal("ANALYTICS_QUERY_RUN_NOT_FOUND", "Analytics query run is unavailable.");
      }
      if (queryRun.status === "succeeded") {
        await this.assertCompletedResult(manager, queryRun);
        return Object.freeze({ kind: "already-succeeded" });
      }
      if (queryRun.status !== "queued" && queryRun.status !== "running") {
        throw fatal("ANALYTICS_QUERY_RUN_INVALID", "Analytics query run cannot execute from its current state.");
      }

      const authorization = await this.authorize(manager, queryRun);
      const query = parseAnalysisQuery(queryRun.normalizedQuery);
      if (
        analyticsDigest(query) !== queryRun.queryDigest ||
        query.sourceKey !== queryRun.sourceKey ||
        query.sourceRevision !== queryRun.sourceRevision ||
        queryRun.sourceKey !== SUPPORT_TICKETS_SOURCE_KEY ||
        queryRun.sourceRevision !== SUPPORT_TICKETS_SOURCE_REVISION ||
        queryRun.policyRevision !== SUPPORT_TICKETS_POLICY_REVISION
      ) {
        throw fatal("ANALYTICS_QUERY_RUN_INVALID", "Analytics query run lineage is invalid.");
      }

      queryRun.status = "running";
      queryRun.startedAt ??= clock;
      queryRun.updatedAt = clock;
      await manager.save(AnalysisQueryRun, queryRun);

      return Object.freeze({
        kind: "execute" as const,
        run: Object.freeze({
          actorId: queryRun.requestedByAccountId,
          integrationTokenId: queryRun.integrationTokenId,
          locale: authorization.preferred_language ?? "zh-Hans",
          policyRevision: queryRun.policyRevision,
          principalType: queryRun.principalType,
          query,
          queryDigest: queryRun.queryDigest,
          requestId: queryRun.requestId,
          sourceKey: queryRun.sourceKey,
          sourceRevision: queryRun.sourceRevision,
          timeZone: authorization.time_zone ?? "UTC",
          workspaceId: trusted.lease.workspaceId,
        } satisfies AuthorizedAnalysisQueryRun),
      });
    });
  }

  async completeInline(
    context: RunHandlerContext,
    input: { policyDigest: string; result: Record<string, unknown> },
  ) {
    const trusted = this.requireTrusted(context);
    await this.dataSource.transaction(async (manager) => {
      const runtimeRun = await this.lockRuntimeRun(manager, trusted);
      const queryRun = await this.lockQueryRun(manager, trusted);
      const clock = await databaseClock(manager);
      assertActiveRuntimeRun(runtimeRun, trusted, clock, false);
      if (queryRun.status === "succeeded") {
        if (
          !queryRun.inlineResult ||
          analyticsDigest(queryRun.inlineResult) !== analyticsDigest(input.result)
        ) {
          throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics result conflicts with the persisted result.");
        }
        return;
      }
      requireRunning(queryRun);
      if (!/^[a-f0-9]{64}$/.test(input.policyDigest)) {
        throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics result policy digest is invalid.");
      }
      queryRun.inlineResult = input.result;
      queryRun.policyDigest = input.policyDigest;
      queryRun.status = "succeeded";
      queryRun.succeededAt = clock;
      queryRun.updatedAt = clock;
      await manager.save(AnalysisQueryRun, queryRun);
      await appendArtifactCreatedEvent(manager, trusted, {
        artifactId: trusted.lease.runId,
        fileObjectId: null,
      });
    });
  }

  async reserveArtifact(
    context: RunHandlerContext,
    input: AnalyticsArtifactCandidate & { bucket: string },
  ): Promise<AnalyticsArtifactReservation> {
    const trusted = this.requireTrusted(context);
    return this.dataSource.transaction(async (manager) => {
      const runtimeRun = await this.lockRuntimeRun(manager, trusted);
      const queryRun = await this.lockQueryRun(manager, trusted);
      requireRunning(queryRun);
      validateArtifactCandidate(input);
      const existing = await manager.findOne(DatasetArtifact, {
        lock: { mode: "pessimistic_write" },
        where: {
          queryRunId: trusted.lease.runId,
          workspaceId: trusted.lease.workspaceId,
        },
      });
      if (existing) {
        if (existing.status !== "pending" || !existing.fileObjectId) {
          throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics artifact reservation is invalid.");
        }
        const supersededFile = await manager.findOne(FileObject, {
          lock: { mode: "pessimistic_write" },
          where: {
            id: existing.fileObjectId,
            workspaceId: trusted.lease.workspaceId,
          },
        });
        if (
          !supersededFile ||
          supersededFile.purpose !== "artifact" ||
          supersededFile.scopeType !== "workspace" ||
          supersededFile.status !== "pending"
        ) {
          throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics artifact file is invalid.");
        }
        const clock = await databaseClock(manager);
        assertActiveRuntimeRun(runtimeRun, trusted, clock, false);

        // A prior generation can still finish its already-issued PUT after its
        // lease is lost. Never reuse that generation's object key: quarantine
        // the old object until its original GC deadline and bind this Artifact
        // to a fresh FileObject in the same transaction.
        supersededFile.failureCode = SUPERSEDED_ARTIFACT_FILE_FAILURE_CODE;
        supersededFile.status = "failed";
        supersededFile.updatedAt = clock;
        await manager.save(FileObject, supersededFile);

        const pendingExpiresAt = pendingFileExpiration(
          clock,
          queryRun.expiresAt,
          this.pendingFileTtlMs,
        );
        const replacementFile = createPendingArtifactFile(
          manager,
          queryRun,
          trusted,
          input,
          pendingExpiresAt,
          supersededFile,
        );
        const savedReplacementFile = await manager.save(
          FileObject,
          replacementFile,
        );

        existing.byteSize = input.byteSize;
        existing.expiresAt = pendingExpiresAt;
        existing.failedAt = null;
        existing.failureCode = null;
        existing.fileObjectId = savedReplacementFile.id;
        existing.lineage = input.lineage;
        existing.preview = [...input.preview];
        existing.readyAt = null;
        existing.resultSchema = [...input.resultSchema];
        existing.rowCount = input.rowCount;
        existing.sha256 = input.sha256;
        existing.status = "pending";
        existing.updatedAt = clock;
        await manager.save(DatasetArtifact, existing);
        return reservation(existing, savedReplacementFile);
      }

      const clock = await databaseClock(manager);
      assertActiveRuntimeRun(runtimeRun, trusted, clock, false);
      const expiresAt = pendingFileExpiration(
        clock,
        queryRun.expiresAt,
        this.pendingFileTtlMs,
      );
      const file = createPendingArtifactFile(
        manager,
        queryRun,
        trusted,
        input,
        expiresAt,
      );
      const savedFile = await manager.save(FileObject, file);
      const artifact = manager.create(DatasetArtifact, {
        byteSize: input.byteSize,
        expiresAt,
        failedAt: null,
        failureCode: null,
        fileObjectId: savedFile.id,
        id: randomUUID(),
        lineage: input.lineage,
        preview: [...input.preview],
        queryRunId: trusted.lease.runId,
        readyAt: null,
        resultSchema: [...input.resultSchema],
        rowCount: input.rowCount,
        schemaVersion: DATASET_ARTIFACT_SCHEMA_VERSION,
        sha256: input.sha256,
        status: "pending",
        workspaceId: trusted.lease.workspaceId,
      });
      const savedArtifact = await manager.save(DatasetArtifact, artifact);
      return reservation(savedArtifact, savedFile);
    });
  }

  async completeArtifact(
    context: RunHandlerContext,
    input: AnalyticsArtifactCandidate & {
      artifactId: string;
      etag: string | null;
      fileObjectId: string;
    },
  ) {
    const trusted = this.requireTrusted(context);
    await this.dataSource.transaction(async (manager) => {
      const runtimeRun = await this.lockRuntimeRun(manager, trusted);
      const queryRun = await this.lockQueryRun(manager, trusted);
      const clock = await databaseClock(manager);
      assertActiveRuntimeRun(runtimeRun, trusted, clock, false);
      const artifact = await manager.findOne(DatasetArtifact, {
        lock: { mode: "pessimistic_write" },
        where: {
          id: input.artifactId,
          queryRunId: trusted.lease.runId,
          workspaceId: trusted.lease.workspaceId,
        },
      });
      if (!artifact || artifact.fileObjectId !== input.fileObjectId) {
        throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics artifact reservation is invalid.");
      }
      assertSameArtifact(artifact, input);

      if (queryRun.status === "succeeded" && artifact.status === "ready") {
        return;
      }
      requireRunning(queryRun);
      if (artifact.status !== "pending") {
        throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics artifact is not pending.");
      }
      const file = await manager.findOne(FileObject, {
        lock: { mode: "pessimistic_write" },
        where: {
          id: input.fileObjectId,
          workspaceId: trusted.lease.workspaceId,
        },
      });
      if (
        !file ||
        file.status !== "pending" ||
        file.purpose !== "artifact" ||
        file.scopeType !== "workspace" ||
        file.retention !== "temporary" ||
        file.byteSize !== input.byteSize
      ) {
        throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics artifact file is not pending.");
      }
      if (!file.expiresAt || file.expiresAt <= clock) {
        throw fatal(
          "ANALYTICS_ARTIFACT_INVALID",
          "Analytics artifact reservation has expired.",
        );
      }

      const resultExpiresAt = queryRun.expiresAt;
      file.etag = normalizeEtag(input.etag);
      file.failureCode = null;
      file.sha256 = input.sha256;
      file.status = "ready";
      file.expiresAt = resultExpiresAt;
      file.updatedAt = clock;
      await manager.save(FileObject, file);

      artifact.readyAt = clock;
      artifact.expiresAt = resultExpiresAt;
      artifact.status = "ready";
      artifact.updatedAt = clock;
      await manager.save(DatasetArtifact, artifact);

      queryRun.inlineResult = null;
      queryRun.policyDigest = input.lineage.policyDigest;
      queryRun.status = "succeeded";
      queryRun.succeededAt = clock;
      queryRun.updatedAt = clock;
      await manager.save(AnalysisQueryRun, queryRun);
      await appendArtifactCreatedEvent(manager, trusted, {
        artifactId: artifact.id,
        fileObjectId: artifact.fileObjectId,
      });
    });
  }

  async settleFailure(
    context: RunHandlerContext,
    input: {
      errorCode: string | null;
      status: "cancelled" | "failed" | "timedOut";
    },
  ) {
    const trusted = this.requireTrusted(context);
    await this.dataSource.transaction(async (manager) => {
      const runtimeRun = await this.lockRuntimeRun(manager, trusted);
      const queryRun = await this.lockQueryRun(manager, trusted);
      const clock = await databaseClock(manager);
      assertActiveRuntimeRun(runtimeRun, trusted, clock, true);
      if (isTerminal(queryRun.status)) return;
      if (
        queryRun.status !== "running" &&
        queryRun.status !== "queued" &&
        queryRun.status !== "cancelling"
      ) {
        throw staleLease();
      }
      const cancellationWon =
        runtimeRun.status === "cancelling" ||
        runtimeRun.cancellationRequestedAt !== null;
      const deadlineWon = Boolean(
        runtimeRun.deadlineAt && runtimeRun.deadlineAt <= clock,
      );
      if (queryRun.status === "cancelling" && !cancellationWon && !deadlineWon) {
        throw staleLease();
      }
      const status = cancellationWon
        ? "cancelled"
        : deadlineWon
          ? "timedOut"
          : input.status;
      queryRun.status = status;
      queryRun.failureCode =
        status === "failed" || status === "timedOut"
          ? normalizeErrorCode(
              status === "timedOut"
                ? "ANALYTICS_QUERY_TIMEOUT"
                : input.errorCode,
            )
          : null;
      if (status === "cancelled") queryRun.cancelledAt = clock;
      if (status === "failed") queryRun.failedAt = clock;
      if (status === "timedOut") queryRun.timedOutAt = clock;
      queryRun.updatedAt = clock;
      await manager.save(AnalysisQueryRun, queryRun);

      const artifact = await manager.findOne(DatasetArtifact, {
        lock: { mode: "pessimistic_write" },
        where: {
          queryRunId: trusted.lease.runId,
          workspaceId: trusted.lease.workspaceId,
        },
      });
      if (artifact?.status === "pending") {
        artifact.failedAt = clock;
        artifact.failureCode = queryRun.failureCode ?? "ANALYTICS_QUERY_CANCELLED";
        artifact.status = "failed";
        artifact.updatedAt = clock;
        await manager.save(DatasetArtifact, artifact);
      }
    });
  }

  private requireTrusted(context: RunHandlerContext) {
    const trusted = this.trustedContext.current(false);
    if (
      !trusted ||
      trusted.lease.runId !== context.lease.runId ||
      trusted.lease.workspaceId !== context.lease.workspaceId ||
      trusted.lease.fencingGeneration !== context.lease.fencingGeneration
    ) {
      throw staleLease();
    }
    return trusted;
  }

  private async lockRuntimeRun(
    manager: EntityManager,
    trusted: ReturnType<TrustedRunContextService["current"]> & object,
  ) {
    const run = await manager.findOne(RuntimeRun, {
      lock: { mode: "pessimistic_write" },
      where: { id: trusted.lease.runId, workspaceId: trusted.lease.workspaceId },
    });
    if (!run) throw staleLease();
    return run;
  }

  private async lockQueryRun(
    manager: EntityManager,
    trusted: ReturnType<TrustedRunContextService["current"]> & object,
  ) {
    const queryRun = await manager.findOne(AnalysisQueryRun, {
      lock: { mode: "pessimistic_write" },
      where: { id: trusted.lease.runId, workspaceId: trusted.lease.workspaceId },
    });
    if (!queryRun) throw staleLease();
    return queryRun;
  }

  private async authorize(
    manager: EntityManager,
    queryRun: AnalysisQueryRun,
  ) {
    const rows = (await manager.query(
      `SELECT
         COALESCE(workspace_setting."value", platform_setting."value", 'false') AS "feature_enabled",
         account."preferred_language",
         account."time_zone",
         (
           SELECT COUNT(DISTINCT permission."code")
           FROM "user_workspace_roles" membership
           INNER JOIN "roles" role
             ON role."id" = membership."role_id"
            AND role."scope" = 'workspace'
            AND role."workspace_id" = membership."workspace_id"
           INNER JOIN "role_permissions" role_permission
             ON role_permission."role_id" = role."id"
            AND role_permission."enabled" = true
           INNER JOIN "permissions" permission
             ON permission."id" = role_permission."permission_id"
            AND permission."code" = ANY($3::varchar[])
            AND permission."scope" = 'workspace'
           WHERE membership."workspace_id" = $1
             AND membership."user_id" = $2
             AND membership."status" = 'active'
         ) = cardinality($3::varchar[]) AS "allowed"
       FROM "users" account
       INNER JOIN "workspaces" workspace
         ON workspace."id" = $1
        AND workspace."status" IN ('active', 'provisioning')
        AND workspace."deleted_at" IS NULL
       LEFT JOIN "workspace_settings" workspace_setting
         ON workspace_setting."workspace_id" = $1
        AND workspace_setting."name" = $4
       LEFT JOIN "platform_settings" platform_setting
         ON platform_setting."name" = $4
       WHERE account."id" = $2
         AND account."status" = 'active'
         AND account."deleted_at" IS NULL`,
      [
        queryRun.workspaceId,
        queryRun.requestedByAccountId,
        REQUIRED_EXECUTION_PERMISSIONS,
        ANALYTICS_FEATURE_KEY,
      ],
    )) as AuthorizationRow[];
    const authorization = rows[0];
    if (
      rows.length !== 1 ||
      authorization.feature_enabled !== "true" ||
      !authorization.allowed
    ) {
      throw fatal("ANALYTICS_FEATURE_DISABLED", "Analytics access is no longer available.");
    }

    if (queryRun.principalType === "integration") {
      const tokenRows = (await manager.query(
        `SELECT EXISTS (
           SELECT 1
           FROM "integration_tokens"
           WHERE "workspace_id" = $1
             AND "id" = $2
             AND "owner_user_id" = $3
             AND "scope" = 'workspace'
             AND "revoked_at" IS NULL
             AND "expires_at" > clock_timestamp()
             AND "permissions" @> $4::jsonb
         ) AS "allowed"`,
        [
          queryRun.workspaceId,
          queryRun.integrationTokenId,
          queryRun.requestedByAccountId,
          JSON.stringify(REQUIRED_EXECUTION_PERMISSIONS),
        ],
      )) as TokenAuthorizationRow[];
      if (tokenRows.length !== 1 || !tokenRows[0]?.allowed) {
        throw fatal("ANALYTICS_SOURCE_FORBIDDEN", "Analytics access is no longer available.");
      }
    } else if (queryRun.integrationTokenId !== null) {
      throw fatal("ANALYTICS_QUERY_RUN_INVALID", "Analytics query principal is invalid.");
    }
    return authorization;
  }

  private async assertCompletedResult(
    manager: EntityManager,
    queryRun: AnalysisQueryRun,
  ) {
    if (queryRun.inlineResult) return;
    const artifact = await manager.findOne(DatasetArtifact, {
      where: {
        queryRunId: queryRun.id,
        status: "ready",
        workspaceId: queryRun.workspaceId,
      },
    });
    if (!artifact?.fileObjectId) {
      throw fatal("ANALYTICS_ARTIFACT_INVALID", "Completed analytics result is missing.");
    }
  }
}

function validateArtifactCandidate(input: AnalyticsArtifactCandidate) {
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    !Number.isSafeInteger(input.rowCount) ||
    input.rowCount < 0 ||
    !/^[a-f0-9]{64}$/.test(input.sha256) ||
    input.preview.length > 100
  ) {
    throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics artifact metadata is invalid.");
  }
}

function assertSameArtifact(
  artifact: DatasetArtifact,
  input: AnalyticsArtifactCandidate,
) {
  if (
    artifact.byteSize !== input.byteSize ||
    artifact.rowCount !== input.rowCount ||
    artifact.sha256 !== input.sha256 ||
    analyticsDigest(artifact.lineage) !== analyticsDigest(input.lineage) ||
    analyticsDigest(artifact.resultSchema) !== analyticsDigest(input.resultSchema) ||
    analyticsDigest(artifact.preview) !== analyticsDigest(input.preview)
  ) {
    throw fatal("ANALYTICS_ARTIFACT_INVALID", "Analytics artifact retry conflicts with its reservation.");
  }
}

function reservation(
  artifact: DatasetArtifact,
  file: FileObject,
): AnalyticsArtifactReservation {
  return Object.freeze({
    artifactId: artifact.id,
    bucket: file.bucket,
    fileObjectId: file.id,
    objectKey: file.objectKey,
  });
}

async function appendArtifactCreatedEvent(
  manager: EntityManager,
  trusted: {
    lease: { fencingGeneration: number; runId: string; workspaceId: string };
    leaseToken: string;
  },
  input: { artifactId: string; fileObjectId: string | null },
) {
  const rows = (await manager.query(
    `WITH database_clock AS MATERIALIZED (
       SELECT clock_timestamp() AS "now"
     ), advanced_run AS (
       UPDATE "runtime_runs" runtime_run
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
         AND (
           runtime_run."deadline_at" IS NULL
           OR runtime_run."deadline_at" > database_clock."now"
         )
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
       $1::uuid, $2::uuid, advanced_run."event_sequence", $5, $6, $7,
       NULL, NULL, database_clock."now",
       jsonb_build_object(
         'artifactId', $8::uuid,
         'artifactType', 'table',
         'fileObjectId', $9::uuid,
         'title', 'Analytics query result'
       )
     FROM advanced_run
     CROSS JOIN database_clock
     RETURNING "id"`,
    [
      trusted.lease.workspaceId,
      trusted.lease.runId,
      trusted.leaseToken,
      trusted.lease.fencingGeneration,
      RUNTIME_RUN_EVENT_SCHEMA_VERSION,
      `${ARTIFACT_CREATED_EVENT_TYPE}:${trusted.lease.runId}:result`,
      ARTIFACT_CREATED_EVENT_TYPE,
      input.artifactId,
      input.fileObjectId,
    ],
  )) as Array<{ id: unknown }>;
  if (rows.length !== 1) throw staleLease();
}

async function databaseClock(manager: EntityManager) {
  const rows = (await manager.query(
    `SELECT clock_timestamp() AS "database_now"`,
  )) as Array<{ database_now: Date | string }>;
  const value = rows[0]?.database_now;
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  if (rows.length !== 1 || !Number.isFinite(date.getTime())) throw staleLease();
  return date;
}

function assertActiveRuntimeRun(
  run: RuntimeRun,
  trusted: {
    lease: { fencingGeneration: number };
    leaseToken: string;
  },
  clock: Date,
  allowCancelling: boolean,
) {
  if (
    run.leaseToken !== trusted.leaseToken ||
    run.leaseGeneration !== trusted.lease.fencingGeneration ||
    !run.leaseExpiresAt ||
    run.leaseExpiresAt <= clock ||
    (run.status !== "running" &&
      !(allowCancelling && run.status === "cancelling")) ||
    (!allowCancelling && run.cancellationRequestedAt !== null)
  ) {
    throw staleLease();
  }
  if (!allowCancelling && run.deadlineAt && run.deadlineAt <= clock) {
    throw fatal(
      "ANALYTICS_QUERY_TIMEOUT",
      "Analytics query deadline has expired.",
    );
  }
}

function requireRunning(queryRun: AnalysisQueryRun) {
  if (queryRun.status !== "running") throw staleLease();
}

function isTerminal(status: AnalysisQueryRun["status"]) {
  return (
    status === "cancelled" ||
    status === "failed" ||
    status === "succeeded" ||
    status === "timedOut"
  );
}

function requireStorageBucket(value: string) {
  const bucket = value.trim();
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw fatal("ANALYTICS_ARTIFACT_UNAVAILABLE", "Analytics artifact storage is unavailable.");
  }
  return bucket;
}

function createPendingArtifactFile(
  manager: EntityManager,
  queryRun: AnalysisQueryRun,
  trusted: { lease: { runId: string; workspaceId: string } },
  input: AnalyticsArtifactCandidate & { bucket: string },
  expiresAt: Date,
  supersededFile?: FileObject,
) {
  return manager.create(FileObject, {
    bucket: requireStorageBucket(input.bucket),
    byteSize: input.byteSize,
    createdByAccountId: queryRun.requestedByAccountId,
    deletedAt: null,
    etag: null,
    expiresAt,
    failureCode: null,
    id: randomUuidExcept(supersededFile?.id),
    mimeType: "application/json",
    objectKey: randomObjectKey(supersededFile?.objectKey),
    originalName: `analytics-result-${trusted.lease.runId}.json`,
    purpose: "artifact",
    retention: "temporary",
    scopeType: "workspace",
    sha256: null,
    status: "pending",
    storageBackend: "s3",
    workspaceId: trusted.lease.workspaceId,
  });
}

function pendingFileExpiration(
  clock: Date,
  artifactExpiresAt: Date,
  pendingFileTtlMs: number,
) {
  return new Date(
    Math.min(
      artifactExpiresAt.getTime(),
      clock.getTime() + pendingFileTtlMs,
    ),
  );
}

function randomUuidExcept(excluded: string | undefined) {
  let value: string;
  do {
    value = randomUUID();
  } while (value === excluded);
  return value;
}

function randomObjectKey(excluded: string | undefined) {
  let value: string;
  do {
    value = `${randomUUID().replaceAll("-", "")}/${randomUUID().replaceAll("-", "")}`;
  } while (value === excluded);
  return value;
}

function normalizeEtag(value: string | null) {
  const etag = value?.trim().replace(/^"|"$/g, "") ?? null;
  return etag ? etag.slice(0, 200) : null;
}

function normalizeErrorCode(value: string | null) {
  const code = value?.trim().slice(0, 128) ?? "";
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(code)
    ? code
    : "ANALYTICS_QUERY_RUN_UNAVAILABLE";
}

function fatal(code: string, message: string) {
  return new AnalyticsQueryRunHandlerError(code, false, message);
}

function staleLease() {
  return fatal("ANALYTICS_QUERY_RUN_STALE_LEASE", "Analytics query run lease is stale.");
}
