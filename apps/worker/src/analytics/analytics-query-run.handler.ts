import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  DatasetResult,
  DatasetResultRow,
} from "@hermes-swarm/api-contracts/analytics";
import type {
  RunHandler,
  RunHandlerContext,
  RunOutcome,
} from "@hermes-swarm/agent-sdk";
import {
  ANALYTICS_ARTIFACT_STORAGE,
  AnalyticsArtifactStorageDisabledError,
  AnalyticsArtifactStorageUnavailableError,
  type AnalyticsArtifactStorage,
} from "../storage/analytics-artifact-storage.js";
import {
  ANALYTICS_QUERY_EXECUTOR,
  type AnalyticsQueryExecutor,
} from "./analytics-query-executor.js";
import {
  ANALYTICS_QUERY_INLINE_MAX_BYTES,
  ANALYTICS_QUERY_RUN_KIND,
  ANALYTICS_QUERY_RUN_STORE,
  AnalyticsQueryRunHandlerError,
  type AnalyticsArtifactCandidate,
  type AnalyticsQueryRunStore,
} from "./analytics-query-run.types.js";

const MAX_PREVIEW_ROWS = 100;
const MAX_PREVIEW_BYTES = 256 * 1024;

@Injectable()
export class AnalyticsQueryRunHandler
  implements RunHandler<typeof ANALYTICS_QUERY_RUN_KIND>
{
  readonly kind = ANALYTICS_QUERY_RUN_KIND;

  constructor(
    @Inject(ANALYTICS_QUERY_RUN_STORE)
    private readonly store: AnalyticsQueryRunStore,
    @Inject(ANALYTICS_QUERY_EXECUTOR)
    private readonly executor: AnalyticsQueryExecutor,
    @Inject(ANALYTICS_ARTIFACT_STORAGE)
    private readonly artifactStorage: AnalyticsArtifactStorage,
  ) {}

  async execute(context: RunHandlerContext): Promise<RunOutcome> {
    try {
      const prepared = await this.store.prepare(context);
      if (prepared.kind === "already-succeeded") {
        return Object.freeze({ status: "succeeded" });
      }

      const result = await this.executor.execute(prepared.run, context.signal);
      throwIfAborted(context.signal);
      const body = Buffer.from(JSON.stringify(result), "utf8");
      if (body.byteLength <= ANALYTICS_QUERY_INLINE_MAX_BYTES) {
        await this.store.completeInline(context, {
          policyDigest: result.lineage.policyDigest,
          result,
        });
        return Object.freeze({ status: "succeeded" });
      }

      if (!this.artifactStorage.enabled) {
        throw new AnalyticsArtifactStorageDisabledError();
      }
      const candidate = createArtifactCandidate(result, body);
      const reservation = await this.store.reserveArtifact(context, {
        ...candidate,
        bucket: this.artifactStorage.bucket,
      });
      const uploaded = await this.artifactStorage.put({
        body,
        key: reservation.objectKey,
        mimeType: "application/json",
        signal: context.signal,
      });
      throwIfAborted(context.signal);
      await this.store.completeArtifact(context, {
        ...candidate,
        artifactId: reservation.artifactId,
        etag: uploaded.etag,
        fileObjectId: reservation.fileObjectId,
      });
      return Object.freeze({ status: "succeeded" });
    } catch (error) {
      return this.failureOutcome(context, error);
    }
  }

  private async failureOutcome(
    context: RunHandlerContext,
    error: unknown,
  ): Promise<RunOutcome> {
    const aborted = abortStatus(context.signal);
    if (aborted === "cancelled" || aborted === "timedOut") {
      await this.trySettle(context, {
        errorCode: aborted === "timedOut" ? "ANALYTICS_QUERY_TIMEOUT" : null,
        status: aborted,
      });
      return aborted === "cancelled"
        ? Object.freeze({ status: "cancelled" })
        : Object.freeze({
            failure: Object.freeze({
              code: "ANALYTICS_QUERY_TIMEOUT",
              message: "Analytics query exceeded its execution deadline.",
              retryable: false,
            }),
            status: "timedOut",
          });
    }

    if (aborted === "retryable") {
      return this.normalizedFailureOutcome(context, {
        code: "ANALYTICS_QUERY_RUN_UNAVAILABLE",
        message: "Analytics query execution was interrupted.",
        retryable: true,
      });
    }

    return this.normalizedFailureOutcome(context, normalizeFailure(error));
  }

  private async normalizedFailureOutcome(
    context: RunHandlerContext,
    failure: { code: string; message: string; retryable: boolean },
  ): Promise<RunOutcome> {
    const retryable =
      failure.retryable && this.store.hasRemainingAttempts(context);
    if (!retryable) {
      await this.trySettle(context, {
        errorCode: failure.code,
        status: "failed",
      });
    }
    return Object.freeze({
      failure: Object.freeze({ ...failure, retryable }),
      status: "failed",
    });
  }

  private async trySettle(
    context: RunHandlerContext,
    input: Parameters<AnalyticsQueryRunStore["settleFailure"]>[1],
  ) {
    try {
      await this.store.settleFailure(context, input);
    } catch {
      // Runtime lease fencing remains authoritative. The consumer will recover
      // a stale delivery and must not replace the original handler failure.
    }
  }
}

function createArtifactCandidate(
  result: DatasetResult,
  body: Buffer,
): AnalyticsArtifactCandidate {
  return Object.freeze({
    byteSize: body.byteLength,
    lineage: result.lineage,
    preview: Object.freeze(createPreview(result.rows)),
    resultSchema: Object.freeze([...result.schema]),
    rowCount: result.rows.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  });
}

function createPreview(rows: readonly DatasetResultRow[]) {
  const preview: DatasetResultRow[] = [];
  for (const row of rows.slice(0, MAX_PREVIEW_ROWS)) {
    const candidate = [...preview, row];
    if (Buffer.byteLength(JSON.stringify(candidate), "utf8") > MAX_PREVIEW_BYTES) {
      break;
    }
    preview.push(row);
  }
  return preview;
}

function normalizeFailure(error: unknown) {
  if (
    error instanceof AnalyticsQueryRunHandlerError ||
    error instanceof AnalyticsArtifactStorageDisabledError ||
    error instanceof AnalyticsArtifactStorageUnavailableError
  ) {
    const code = normalizeErrorCode(error.code);
    return {
      code,
      message: error.message.slice(0, 1_024),
      retryable: error.retryable,
    };
  }
  const wrapped = new AnalyticsQueryRunHandlerError(
    "ANALYTICS_QUERY_RUN_UNAVAILABLE",
    true,
    "Analytics query execution is temporarily unavailable.",
  );
  return {
    code: wrapped.code,
    message: wrapped.message,
    retryable: wrapped.retryable,
  };
}

function normalizeErrorCode(value: string) {
  const code = value.trim().slice(0, 128);
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(code)
    ? code
    : "ANALYTICS_QUERY_RUN_UNAVAILABLE";
}

function abortStatus(
  signal: AbortSignal,
): "cancelled" | "retryable" | "timedOut" | null {
  if (!signal.aborted) return null;
  const reason = signal.reason;
  const message = reason instanceof Error ? reason.message : String(reason ?? "");
  // A worker shutdown can mention its own drain deadline without meaning the
  // persisted Run deadline expired. Keep infrastructure interruptions
  // retryable and only classify the Runtime Run's deadline as a query timeout.
  if (/worker shutdown|heartbeat failed|\bstale\b/i.test(message)) {
    return "retryable";
  }
  if (/runtime run (?:deadline exceeded|timed.?out)/i.test(message)) {
    return "timedOut";
  }
  if (/cancell/i.test(message)) return "cancelled";
  return "retryable";
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) throw signal.reason;
}
