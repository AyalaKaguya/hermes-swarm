import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ANALYTICS_QUERY_TIMEOUT_MS,
  AnalyticsErrorCodeSchema,
  AnalysisQueryResultSchema,
  AnalysisQueryRunSchema,
  CreateAnalysisQueryRunRequestSchema,
  DatasetArtifactSchema,
  DatasetResultSchema,
  type AnalysisQueryResult,
  type AnalysisQueryRun,
  type CreateAnalysisQueryRunRequest,
  type DatasetArtifact,
} from "@hermes-swarm/api-contracts/analytics";
import {
  AnalysisQueryRun as AnalysisQueryRunEntity,
  DatasetArtifact as DatasetArtifactEntity,
  FileObject,
  RuntimeRun,
} from "@hermes-swarm/core";
import { DataSource, type EntityManager } from "typeorm";
import { WorkspaceContextService } from "../../common/database/workspace-context.service.js";
import { RuntimeSubmissionService } from "../../common/jobs/runtime-submission.service.js";
import {
  RuntimeCancellationNotFoundError,
  RuntimeSubmissionConflictError,
  RuntimeSubmissionInvariantError,
  RuntimeSubmissionValidationError,
} from "../../common/jobs/runtime-submission.types.js";
import {
  ObjectStorage,
  ObjectStorageDisabledError,
  ObjectStorageNotFoundError,
  ObjectStorageUnavailableError,
} from "../../infrastructure/files/object-storage.js";
import { analyticsDigest } from "./analytics-digest.js";
import { AnalyticsQueryGateway } from "./analytics-query.gateway.js";
import type { AnalyticsAuthorizationContext } from "./analytics-source.adapter.js";
import { AnalyticsSourceRegistry } from "./analytics-source.registry.js";

export const ANALYSIS_QUERY_RUN_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const ANALYTICS_QUERY_RUN_KIND = "analytics.query" as const;

@Injectable()
export class AnalysisQueryRunService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly workspaceContext: WorkspaceContextService,
    private readonly runtimeSubmission: RuntimeSubmissionService,
    private readonly gateway: AnalyticsQueryGateway,
    private readonly sourceRegistry: AnalyticsSourceRegistry,
    private readonly objectStorage: ObjectStorage,
    private readonly configService: ConfigService,
  ) {}

  async submit(
    payload: unknown,
    authorization: AnalyticsAuthorizationContext,
  ): Promise<AnalysisQueryRun> {
    const input = parseCreateRequest(payload);
    const workspaceId = this.currentWorkspaceId();
    requireTrustedAuthorization(authorization);
    const validated = await this.gateway.validate(input.query, authorization);
    const registration = this.sourceRegistry.resolve(validated.query.sourceKey);
    if (!registration) throw queryRunUnavailable();

    const queryDigest = analyticsDigest(validated.query);
    const requestDigest = analyticsDigest({
      actorId: authorization.actorId,
      integrationTokenId: authorization.integrationTokenId,
      policyRevision: registration.policyRevision,
      principalType: authorization.principalType,
      queryDigest,
    });

    try {
      const entity = await this.dataSource.transaction(
        "READ COMMITTED",
        async (manager) => {
          const databaseNow = await readDatabaseClock(manager);
          const submission = await this.runtimeSubmission.submitInTransaction(
            manager,
            {
              availableAt: databaseNow,
              correlationId: authorization.requestId,
              deadlineAt: new Date(
                databaseNow.getTime() + ANALYTICS_QUERY_TIMEOUT_MS,
              ),
              idempotencyKey: input.idempotencyKey,
              requestDigest,
              runKind: ANALYTICS_QUERY_RUN_KIND,
            },
          );
          if (submission.deduplicated) {
            const reconciled = await this.lockAndReconcileRun(
              manager,
              workspaceId,
              submission.run.id,
              true,
            );
            assertMatchingSubmission(reconciled.entity, {
              authorization,
              policyRevision: registration.policyRevision,
              queryDigest,
              requestDigest,
              runtimeRun: reconciled.runtimeRun,
              workspaceId,
            });
            return reconciled.entity;
          }

          const repository = manager.getRepository(AnalysisQueryRunEntity);
          const existing = await repository.findOne({
            where: { id: submission.run.id, workspaceId },
          });
          if (existing) throw queryRunInvariant();

          return repository.save(
            repository.create({
              cancelledAt: null,
              cancellingAt: null,
              createdAt: databaseNow,
              expiresAt: new Date(
                databaseNow.getTime() + ANALYSIS_QUERY_RUN_RETENTION_MS,
              ),
              failedAt: null,
              failureCode: null,
              id: submission.run.id,
              inlineResult: null,
              integrationTokenId: authorization.integrationTokenId,
              normalizedQuery: validated.query,
              policyDigest: null,
              policyRevision: registration.policyRevision,
              principalType: authorization.principalType,
              queryDigest,
              queuedAt: databaseNow,
              requestId: authorization.requestId,
              requestedByAccountId: authorization.actorId,
              sourceKey: validated.query.sourceKey,
              sourceRevision: validated.query.sourceRevision,
              startedAt: null,
              status: "queued",
              succeededAt: null,
              timedOutAt: null,
              updatedAt: databaseNow,
              waitingAt: null,
              workspaceId,
            }),
          );
        },
      );
      const artifact =
        entity.status === "succeeded" && entity.inlineResult === null
          ? await this.findArtifactForRun(workspaceId, entity.id)
          : null;
      return this.toRunDto(entity, artifact);
    } catch (error) {
      if (error instanceof RuntimeSubmissionConflictError) {
        throw idempotencyConflict();
      }
      if (
        error instanceof RuntimeSubmissionInvariantError ||
        error instanceof RuntimeSubmissionValidationError
      ) {
        throw queryRunInvariant();
      }
      throw error;
    }
  }

  async get(runId: string): Promise<AnalysisQueryRun> {
    const workspaceId = this.currentWorkspaceId();
    const run = await this.reconcileRun(workspaceId, runId);
    const artifact = await this.findArtifactForRun(workspaceId, run.id);
    return this.toRunDto(run, artifact);
  }

  async cancel(runId: string): Promise<AnalysisQueryRun> {
    const workspaceId = this.currentWorkspaceId();
    try {
      const run = await this.dataSource.transaction(
        "READ COMMITTED",
        async (manager) => {
          const repository = manager.getRepository(AnalysisQueryRunEntity);
          const existing = await repository.findOne({
            where: { id: runId, workspaceId },
          });
          if (!existing || isExpired(existing.expiresAt)) {
            throw queryRunNotFound();
          }
          if (isTerminalRunStatus(existing.status)) {
            // RuntimeRun remains authoritative even for an apparently
            // terminal domain row; reconcile before returning idempotently.
            throw new QueryRunBecameTerminalError();
          }

          const runtimeRun =
            await this.runtimeSubmission.requestCancellationInTransaction(
              manager,
              existing.id,
            );
          // Runtime workers always lock RuntimeRun before the domain row. Keep
          // the same order here so cancellation cannot deadlock completion.
          const entity = await repository.findOne({
            lock: { mode: "pessimistic_write" },
            where: { id: runId, workspaceId },
          });
          if (!entity || isExpired(entity.expiresAt)) {
            throw queryRunNotFound();
          }
          if (isTerminalRunStatus(entity.status)) {
            // Throwing rolls back the Runtime cancellation requested above.
            // The terminal domain result committed in the worker transaction
            // is re-read only after this transaction has rolled back.
            throw new QueryRunBecameTerminalError();
          }
          if (runtimeRun.status === "succeeded") throw queryRunInvariant();
          applyRuntimeCancellation(entity, runtimeRun);
          return repository.save(entity);
        },
      );
      const artifact = await this.findArtifactForRun(workspaceId, run.id);
      return this.toRunDto(run, artifact);
    } catch (error) {
      if (error instanceof QueryRunBecameTerminalError) {
        const terminal = await this.reconcileRun(workspaceId, runId);
        if (!isTerminalRunStatus(terminal.status)) throw queryRunInvariant();
        const artifact = await this.findArtifactForRun(
          workspaceId,
          terminal.id,
        );
        return this.toRunDto(terminal, artifact);
      }
      if (error instanceof RuntimeCancellationNotFoundError) {
        throw queryRunNotFound();
      }
      if (
        error instanceof RuntimeSubmissionInvariantError ||
        error instanceof RuntimeSubmissionValidationError
      ) {
        throw queryRunInvariant();
      }
      throw error;
    }
  }

  async getResult(runId: string): Promise<AnalysisQueryResult> {
    const workspaceId = this.currentWorkspaceId();
    const run = await this.reconcileRun(workspaceId, runId);
    if (run.status !== "succeeded") throw queryRunNotReady();

    if (run.inlineResult !== null) {
      const result = DatasetResultSchema.safeParse(run.inlineResult);
      if (!result.success) throw queryRunInvariant();
      return AnalysisQueryResultSchema.parse({
        kind: "inline",
        result: result.data,
      });
    }

    const artifact = await this.findArtifactForRun(workspaceId, run.id);
    if (!artifact) throw queryRunInvariant();
    if (artifact.status !== "ready" || isExpired(artifact.expiresAt)) {
      throw artifactNotReady();
    }
    return AnalysisQueryResultSchema.parse({
      artifact: this.toArtifactDto(artifact),
      kind: "artifact",
    });
  }

  async getArtifactContentUrl(artifactId: string): Promise<string> {
    const workspaceId = this.currentWorkspaceId();
    const repository = this.dataSource.getRepository(DatasetArtifactEntity);
    const candidate = await repository.findOne({
      where: { id: artifactId, workspaceId },
    });
    if (!candidate || isExpired(candidate.expiresAt)) throw artifactNotFound();
    if (candidate.status !== "ready" || !candidate.fileObjectId) {
      throw artifactNotReady();
    }

    let run: AnalysisQueryRunEntity;
    try {
      run = await this.reconcileRun(workspaceId, candidate.queryRunId);
    } catch (error) {
      if (error instanceof NotFoundException) throw artifactNotFound();
      throw error;
    }
    if (run.status !== "succeeded") throw artifactNotReady();

    const artifact = await repository.findOne({
      relations: { fileObject: true },
      where: { id: artifactId, queryRunId: run.id, workspaceId },
    });
    if (!artifact || isExpired(artifact.expiresAt)) throw artifactNotFound();
    if (artifact.status !== "ready" || !artifact.fileObjectId) {
      throw artifactNotReady();
    }

    const runDto = this.toRunDto(run, artifact);
    if (
      runDto.status !== "succeeded" ||
      runDto.resultKind !== "artifact" ||
      runDto.artifactId !== artifact.id
    ) {
      throw artifactNotReady();
    }
    this.toArtifactDto(artifact);
    const file = artifact.fileObject;
    assertValidArtifactFile(artifact, file, workspaceId, this.objectStorage);
    const remainingSeconds = Math.floor(
      (toDate(artifact.expiresAt).getTime() - Date.now()) / 1_000,
    );
    const expiresInSeconds = Math.max(
      1,
      Math.min(
        this.configService.get<number>("storage.downloadUrlTtlSeconds", 300),
        remainingSeconds,
      ),
    );

    try {
      return await this.objectStorage.presignDownload({
        expiresInSeconds,
        key: file.objectKey,
        originalName: file.originalName,
      });
    } catch (error) {
      if (
        error instanceof ObjectStorageDisabledError ||
        error instanceof ObjectStorageNotFoundError ||
        error instanceof ObjectStorageUnavailableError
      ) {
        throw artifactUnavailable();
      }
      throw artifactUnavailable();
    }
  }

  private reconcileRun(workspaceId: string, runId: string) {
    return this.dataSource.transaction("READ COMMITTED", async (manager) => {
      const reconciled = await this.lockAndReconcileRun(
        manager,
        workspaceId,
        runId,
      );
      return reconciled.entity;
    });
  }

  private async lockAndReconcileRun(
    manager: EntityManager,
    workspaceId: string,
    runId: string,
    missingDomainIsInvariant = false,
  ) {
    const runtimeRun = await manager.getRepository(RuntimeRun).findOne({
      lock: { mode: "pessimistic_write" },
      where: { id: runId, workspaceId },
    });
    if (!runtimeRun) {
      if (missingDomainIsInvariant) throw queryRunInvariant();
      throw queryRunNotFound();
    }

    const repository = manager.getRepository(AnalysisQueryRunEntity);
    const entity = await repository.findOne({
      lock: { mode: "pessimistic_write" },
      where: { id: runId, workspaceId },
    });
    if (!entity) {
      if (missingDomainIsInvariant) throw queryRunInvariant();
      throw queryRunNotFound();
    }
    const databaseNow = await readDatabaseClock(manager);
    if (toDate(entity.expiresAt).getTime() <= databaseNow.getTime()) {
      throw queryRunNotFound();
    }
    assertPersistedRuntimeLink(entity, runtimeRun, workspaceId);
    if (runtimeRun.status === "succeeded") {
      if (entity.status !== "succeeded") throw queryRunInvariant();
      return { entity, runtimeRun };
    }
    if (isProjectableRuntimeTerminalStatus(runtimeRun.status)) {
      if (entity.status === runtimeRun.status) return { entity, runtimeRun };

      const invalidatesReadyArtifact =
        entity.status === "succeeded" && entity.inlineResult === null;
      applyRuntimeTerminalProjection(entity, runtimeRun, databaseNow);
      if (invalidatesReadyArtifact) {
        await this.invalidateReadyArtifactForRun(
          manager,
          workspaceId,
          entity.id,
          databaseNow,
        );
      }
      return { entity: await repository.save(entity), runtimeRun };
    }
    if (isTerminalRunStatus(entity.status)) {
      return { entity, runtimeRun };
    }
    return { entity, runtimeRun };
  }

  private async invalidateReadyArtifactForRun(
    manager: EntityManager,
    workspaceId: string,
    queryRunId: string,
    databaseNow: Date,
  ) {
    const repository = manager.getRepository(DatasetArtifactEntity);
    const artifact = await repository.findOne({
      lock: { mode: "pessimistic_write" },
      where: { queryRunId, workspaceId },
    });
    if (!artifact || artifact.status !== "ready") return;

    artifact.fileObjectId = null;
    artifact.preview = null;
    artifact.status = "expired";
    artifact.updatedAt = new Date(databaseNow);
    await repository.save(artifact);
  }

  private findArtifactForRun(workspaceId: string, queryRunId: string) {
    return this.dataSource.getRepository(DatasetArtifactEntity).findOne({
      where: { queryRunId, workspaceId },
    });
  }

  private toRunDto(
    entity: AnalysisQueryRunEntity,
    artifact: DatasetArtifactEntity | null,
  ): AnalysisQueryRun {
    const finishedAt = terminalTimestamp(entity);
    const succeeded = entity.status === "succeeded";
    const resultKind = !succeeded
      ? null
      : entity.inlineResult !== null
        ? "inline"
        : artifact
          ? "artifact"
          : null;
    const parsed = AnalysisQueryRunSchema.safeParse({
      artifactId: succeeded && resultKind === "artifact" ? artifact?.id : null,
      createdAt: toIso(entity.createdAt),
      error: publicRunError(entity),
      expiresAt: toIso(entity.expiresAt),
      finishedAt: finishedAt ? toIso(finishedAt) : null,
      id: entity.id,
      normalizedQuery: entity.normalizedQuery,
      policyDigest: entity.policyDigest,
      policyRevision: entity.policyRevision,
      queryDigest: entity.queryDigest,
      queuedAt: toIso(entity.queuedAt),
      resultKind,
      schemaVersion: entity.schemaVersion,
      sourceKey: entity.sourceKey,
      sourceRevision: entity.sourceRevision,
      startedAt: entity.startedAt ? toIso(entity.startedAt) : null,
      status: entity.status,
      updatedAt: toIso(entity.updatedAt),
    });
    if (!parsed.success) throw queryRunInvariant();
    return parsed.data;
  }

  private toArtifactDto(entity: DatasetArtifactEntity): DatasetArtifact {
    const parsed = DatasetArtifactSchema.safeParse({
      byteSize: entity.byteSize,
      createdAt: toIso(entity.createdAt),
      downloadAvailable:
        entity.status === "ready" &&
        entity.fileObjectId !== null &&
        !isExpired(entity.expiresAt),
      expiresAt: toIso(entity.expiresAt),
      failedAt: entity.failedAt ? toIso(entity.failedAt) : null,
      failureCode: entity.failureCode,
      id: entity.id,
      lineage: entity.lineage,
      preview: entity.preview,
      queryRunId: entity.queryRunId,
      readyAt: entity.readyAt ? toIso(entity.readyAt) : null,
      resultSchema: entity.resultSchema,
      rowCount: entity.rowCount,
      schemaVersion: entity.schemaVersion,
      sha256: entity.sha256,
      status: entity.status,
      updatedAt: toIso(entity.updatedAt),
    });
    if (!parsed.success) throw artifactInvalid();
    return parsed.data;
  }

  private currentWorkspaceId() {
    const workspaceId = this.workspaceContext.current(false)?.workspaceId.trim();
    if (!workspaceId) throw contextRequired();
    return workspaceId;
  }
}

class QueryRunBecameTerminalError extends Error {
  constructor() {
    super("Analysis query run became terminal during cancellation.");
    this.name = "QueryRunBecameTerminalError";
  }
}

function parseCreateRequest(value: unknown): CreateAnalysisQueryRunRequest {
  const parsed = CreateAnalysisQueryRunRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new BadRequestException({
      code: "ANALYTICS_QUERY_RUN_INVALID",
      message: "Analysis query run request did not match its contract.",
      statusCode: 400,
    });
  }
  return parsed.data;
}

function requireTrustedAuthorization(value: AnalyticsAuthorizationContext) {
  const validIntegration =
    value.principalType === "integration" &&
    typeof value.integrationTokenId === "string" &&
    Boolean(value.integrationTokenId.trim());
  const validWorkspace =
    value.principalType === "workspace" && value.integrationTokenId === null;
  if (
    !value.actorId?.trim() ||
    !value.requestId?.trim() ||
    (!validIntegration && !validWorkspace)
  ) {
    throw contextRequired();
  }
}

function assertMatchingSubmission(
  entity: AnalysisQueryRunEntity,
  input: {
    authorization: AnalyticsAuthorizationContext;
    policyRevision: string;
    queryDigest: string;
    requestDigest: string;
    runtimeRun: RuntimeRun;
    workspaceId: string;
  },
) {
  assertPersistedRuntimeLink(entity, input.runtimeRun, input.workspaceId);
  if (
    entity.queryDigest !== input.queryDigest ||
    entity.policyRevision !== input.policyRevision ||
    entity.requestedByAccountId !== input.authorization.actorId ||
    entity.principalType !== input.authorization.principalType ||
    entity.integrationTokenId !== input.authorization.integrationTokenId ||
    input.runtimeRun.requestDigest !== input.requestDigest ||
    persistedRequestDigest(entity) !== input.requestDigest
  ) {
    throw queryRunInvariant();
  }
}

function assertPersistedRuntimeLink(
  entity: AnalysisQueryRunEntity,
  runtimeRun: RuntimeRun,
  workspaceId: string,
) {
  if (
    entity.id !== runtimeRun.id ||
    entity.workspaceId !== workspaceId ||
    runtimeRun.workspaceId !== workspaceId ||
    runtimeRun.runKind !== ANALYTICS_QUERY_RUN_KIND ||
    analyticsDigest(entity.normalizedQuery) !== entity.queryDigest ||
    entity.sourceKey !== entity.normalizedQuery.sourceKey ||
    entity.sourceRevision !== entity.normalizedQuery.sourceRevision ||
    runtimeRun.requestDigest !== persistedRequestDigest(entity)
  ) {
    throw queryRunInvariant();
  }
}

function persistedRequestDigest(entity: AnalysisQueryRunEntity) {
  return analyticsDigest({
    actorId: entity.requestedByAccountId,
    integrationTokenId: entity.integrationTokenId,
    policyRevision: entity.policyRevision,
    principalType: entity.principalType,
    queryDigest: entity.queryDigest,
  });
}

function applyRuntimeTerminalProjection(
  entity: AnalysisQueryRunEntity,
  runtimeRun: RuntimeRun,
  databaseNow: Date,
) {
  if (!isProjectableRuntimeTerminalStatus(runtimeRun.status)) {
    throw queryRunInvariant();
  }
  const finishedAt = requiredRuntimeDate(runtimeRun.finishedAt);
  const queuedAt = toDate(entity.queuedAt);
  const startedAt = runtimeRun.startedAt
    ? requiredRuntimeDate(runtimeRun.startedAt)
    : null;
  if (
    finishedAt.getTime() < queuedAt.getTime() ||
    finishedAt.getTime() > databaseNow.getTime() ||
    (startedAt !== null &&
      (startedAt.getTime() < queuedAt.getTime() ||
        startedAt.getTime() > finishedAt.getTime()))
  ) {
    throw queryRunInvariant();
  }

  entity.status = runtimeRun.status;
  entity.startedAt = startedAt;
  entity.waitingAt = null;
  entity.cancellingAt = null;
  entity.cancelledAt = null;
  entity.succeededAt = null;
  entity.failedAt = null;
  entity.timedOutAt = null;
  entity.failureCode =
    runtimeRun.status === "timedOut"
      ? "ANALYTICS_QUERY_TIMEOUT"
      : runtimeRun.status === "failed"
        ? normalizePublicFailureCode(runtimeRun.lastErrorCode)
        : null;
  entity.inlineResult = null;
  entity.policyDigest = null;
  entity.updatedAt = new Date(databaseNow);
  if (runtimeRun.status === "cancelled") entity.cancelledAt = finishedAt;
  if (runtimeRun.status === "failed") entity.failedAt = finishedAt;
  if (runtimeRun.status === "timedOut") entity.timedOutAt = finishedAt;
}

function requiredRuntimeDate(value: Date | string | null) {
  if (value === null) throw queryRunInvariant();
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) throw queryRunInvariant();
  return date;
}

function applyRuntimeCancellation(
  entity: AnalysisQueryRunEntity,
  runtimeRun: RuntimeRun,
) {
  entity.status = runtimeRun.status;
  entity.startedAt = runtimeRun.startedAt;
  entity.failureCode =
    runtimeRun.status === "failed" || runtimeRun.status === "timedOut"
      ? normalizePublicFailureCode(runtimeRun.lastErrorCode)
      : null;
  if (runtimeRun.status === "cancelling") {
    entity.cancellingAt = runtimeRun.cancellationRequestedAt;
  } else if (runtimeRun.status === "cancelled") {
    entity.cancelledAt = runtimeRun.finishedAt;
  } else if (runtimeRun.status === "failed") {
    entity.failedAt = runtimeRun.finishedAt;
  } else if (runtimeRun.status === "succeeded") {
    entity.succeededAt = runtimeRun.finishedAt;
  } else if (runtimeRun.status === "timedOut") {
    entity.timedOutAt = runtimeRun.finishedAt;
  }
}

function publicRunError(entity: AnalysisQueryRunEntity) {
  if (!entity.failureCode) return null;
  return {
    code: normalizePublicFailureCode(entity.failureCode),
    message:
      entity.status === "timedOut"
        ? "Analytics query exceeded its execution deadline."
        : "Analytics query execution failed.",
  };
}

function normalizePublicFailureCode(value: string | null) {
  const parsedCode = AnalyticsErrorCodeSchema.safeParse(value);
  return parsedCode.success
    ? parsedCode.data
    : "ANALYTICS_QUERY_RUN_UNAVAILABLE";
}

function terminalTimestamp(entity: AnalysisQueryRunEntity) {
  return (
    entity.cancelledAt ??
    entity.succeededAt ??
    entity.failedAt ??
    entity.timedOutAt
  );
}

function isTerminalRunStatus(status: AnalysisQueryRunEntity["status"]) {
  return (
    status === "cancelled" ||
    status === "failed" ||
    status === "succeeded" ||
    status === "timedOut"
  );
}

function isProjectableRuntimeTerminalStatus(
  status: RuntimeRun["status"],
): status is "cancelled" | "failed" | "timedOut" {
  return (
    status === "cancelled" || status === "failed" || status === "timedOut"
  );
}

function assertValidArtifactFile(
  artifact: DatasetArtifactEntity,
  file: FileObject | null,
  workspaceId: string,
  objectStorage: ObjectStorage,
): asserts file is FileObject {
  if (
    !objectStorage.enabled ||
    !file ||
    file.id !== artifact.fileObjectId ||
    file.workspaceId !== workspaceId ||
    file.scopeType !== "workspace" ||
    file.purpose !== "artifact" ||
    file.status !== "ready" ||
    file.bucket !== objectStorage.bucket ||
    file.byteSize !== artifact.byteSize ||
    file.sha256 !== artifact.sha256
  ) {
    if (!objectStorage.enabled) throw artifactUnavailable();
    throw artifactInvalid();
  }
}

async function readDatabaseClock(manager: EntityManager) {
  const rows = (await manager.query(
    `SELECT clock_timestamp() AS "databaseNow"`,
  )) as Array<{ databaseNow?: unknown }>;
  const value = rows.length === 1 ? rows[0]?.databaseNow : undefined;
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) throw queryRunInvariant();
  return date;
}

function isExpired(value: Date | string) {
  return toDate(value).getTime() <= Date.now();
}

function toDate(value: unknown) {
  if (value instanceof Date) return new Date(value.getTime());
  return new Date(String(value));
}

function toIso(value: Date | string) {
  const date = toDate(value);
  if (!Number.isFinite(date.getTime())) throw queryRunInvariant();
  return date.toISOString();
}

function contextRequired() {
  return new InternalServerErrorException({
    code: "ANALYTICS_CONTEXT_REQUIRED",
    message: "A trusted workspace context is required for analytics queries.",
    statusCode: 500,
  });
}

function idempotencyConflict() {
  return new ConflictException({
    code: "ANALYTICS_QUERY_RUN_IDEMPOTENCY_CONFLICT",
    message: "The idempotency key is already bound to another analytics query.",
    statusCode: 409,
  });
}

function queryRunNotFound() {
  return new NotFoundException({
    code: "ANALYTICS_QUERY_RUN_NOT_FOUND",
    message: "Analysis query run was not found.",
    statusCode: 404,
  });
}

function queryRunNotReady() {
  return new ConflictException({
    code: "ANALYTICS_QUERY_RUN_NOT_READY",
    message: "Analysis query result is not ready.",
    statusCode: 409,
  });
}

function queryRunInvariant() {
  return new InternalServerErrorException({
    code: "ANALYTICS_QUERY_RUN_INVALID",
    message: "Analysis query run state is invalid.",
    statusCode: 500,
  });
}

function queryRunUnavailable() {
  return new ServiceUnavailableException({
    code: "ANALYTICS_QUERY_RUN_UNAVAILABLE",
    message: "Analysis query execution is temporarily unavailable.",
    statusCode: 503,
  });
}

function artifactNotFound() {
  return new NotFoundException({
    code: "ANALYTICS_ARTIFACT_NOT_FOUND",
    message: "Dataset artifact was not found.",
    statusCode: 404,
  });
}

function artifactNotReady() {
  return new ConflictException({
    code: "ANALYTICS_ARTIFACT_NOT_READY",
    message: "Dataset artifact is not ready.",
    statusCode: 409,
  });
}

function artifactInvalid() {
  return new InternalServerErrorException({
    code: "ANALYTICS_ARTIFACT_INVALID",
    message: "Stored dataset artifact is invalid.",
    statusCode: 500,
  });
}

function artifactUnavailable() {
  return new ServiceUnavailableException({
    code: "ANALYTICS_ARTIFACT_UNAVAILABLE",
    message: "Dataset artifact storage is temporarily unavailable.",
    statusCode: 503,
  });
}
