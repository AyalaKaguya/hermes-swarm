import { Inject, Injectable } from "@nestjs/common";
import {
  RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES,
  RuntimeRunHandlerRegistry,
  RuntimeRunHandlerRegistryError,
  parseRuntimeDispatchEnvelope,
  type RunFailure,
  type RunOutcome,
} from "@hermes-swarm/agent-sdk";
import {
  RUNTIME_RUN_ERROR_CODES,
  RUNTIME_RUN_STORE,
  type ClaimedRuntimeRun,
  type RuntimeRunStore,
} from "../runtime/runtime-run.types.js";
import { TrustedRunContextService } from "../runtime/trusted-run-context.service.js";
import type {
  RuntimeJobDelivery,
  RuntimeJobProcessor,
} from "./runtime-job-processor.js";

export const RUNTIME_RUN_LEASE_MS = 30_000;
export const RUNTIME_RUN_HEARTBEAT_MS = 10_000;
const MAX_NODE_TIMER_MS = 2_147_483_647;

const DEFAULT_DELIVERY: RuntimeJobDelivery = Object.freeze({
  attempt: 1,
  maxAttempts: 5,
});

export class RuntimeRunRetryError extends Error {
  readonly code = "RUNTIME_RUN_RETRY";

  constructor() {
    super("Runtime run is scheduled for retry.");
    this.name = "RuntimeRunRetryError";
  }
}

@Injectable()
export class RuntimeRunConsumerService implements RuntimeJobProcessor {
  private readonly activeAbortControllers = new Set<AbortController>();

  constructor(
    @Inject(RUNTIME_RUN_STORE) private readonly store: RuntimeRunStore,
    private readonly handlers: RuntimeRunHandlerRegistry,
    private readonly trustedContext: TrustedRunContextService,
  ) {}

  abortActive() {
    const reason = new Error("Runtime worker shutdown deadline exceeded.");
    for (const controller of this.activeAbortControllers) {
      controller.abort(reason);
    }
  }

  async process(value: unknown, delivery = DEFAULT_DELIVERY) {
    const envelope = parseRuntimeDispatchEnvelope(value);
    const queueDelivery = normalizeDelivery(delivery);
    const finalQueueAttempt =
      queueDelivery.attempt >= queueDelivery.maxAttempts;
    const claim = await this.store.claim(envelope, {
      leaseMs: RUNTIME_RUN_LEASE_MS,
      rearmIfDeferred: finalQueueAttempt,
    });

    if (claim.kind === "ignored") return;
    if (claim.kind === "deferred") {
      if (finalQueueAttempt && claim.rearmed) return;
      throw new RuntimeRunRetryError();
    }

    const run = claim.run;
    let handler: ReturnType<RuntimeRunHandlerRegistry["resolve"]>;
    try {
      handler = this.handlers.resolve(run.runKind);
    } catch (error) {
      if (!isUnknownHandlerError(error)) throw error;
      const finished = await this.store.finish(
        run,
        failureOutcome({
          code: error.code,
          message: "Runtime run kind is not registered.",
          retryable: false,
        }),
      );
      if (!finished) await this.store.recoverStaleDelivery(run);
      return;
    }

    const abortController = new AbortController();
    this.activeAbortControllers.add(abortController);
    const deadlineTimer = armDeadline(run.deadlineDelayMs, abortController);
    const heartbeat = startHeartbeat(this.store, run, abortController);
    let outcome: RunOutcome;
    try {
      outcome = await this.trustedContext.run(
        run,
        abortController.signal,
        async (context) => normalizeOutcome(await handler.execute(context)),
      );
    } catch (error) {
      outcome = failureOutcome(failureFromThrown(error));
    } finally {
      this.activeAbortControllers.delete(abortController);
      if (deadlineTimer) clearTimeout(deadlineTimer);
    }

    const heartbeatResult = await heartbeat.stop();
    if (heartbeatResult.error) throw heartbeatResult.error;
    if (heartbeatResult.stopReason === "stale") {
      await this.store.recoverStaleDelivery(run);
      return;
    }
    if (heartbeatResult.stopReason === "timed-out") return;

    if (hasRetryableFailure(outcome)) {
      const requeue = await this.store.requeue(run, {
        errorCode: outcome.failure.code,
        rearmOutbox: finalQueueAttempt,
        retryBackoffMs: runtimeRetryBackoffMs(run.attempt),
      });
      if (requeue === "stale") {
        await this.store.recoverStaleDelivery(run);
        return;
      }
      if (requeue === "finished") return;
      if (finalQueueAttempt) return;
      throw new RuntimeRunRetryError();
    }

    const finished = await this.store.finish(run, outcome);
    if (!finished) await this.store.recoverStaleDelivery(run);
  }
}

export function runtimeRetryBackoffMs(attempt: number) {
  const exponent = Math.max(0, Math.min(8, attempt - 1));
  return Math.min(30_000, 1_000 * 2 ** exponent);
}

function startHeartbeat(
  store: RuntimeRunStore,
  run: ClaimedRuntimeRun,
  abortController: AbortController,
) {
  let running = true;
  let wake: (() => void) | null = null;
  let error: unknown;
  let stopReason: "stale" | "timed-out" | null = null;

  const loop = (async () => {
    while (running) {
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(resolve, RUNTIME_RUN_HEARTBEAT_MS);
        timeout.unref?.();
        wake = () => {
          clearTimeout(timeout);
          resolve();
        };
      });
      wake = null;
      if (!running) break;
      try {
        const result = await store.heartbeat(run, {
          leaseMs: RUNTIME_RUN_LEASE_MS,
        });
        if (result === "active") continue;
        if (result === "stale" || result === "timed-out") {
          stopReason = result;
        }
        abortController.abort(new Error(`Runtime run ${result}.`));
        break;
      } catch (heartbeatError) {
        error = heartbeatError;
        abortController.abort(new Error("Runtime run heartbeat failed."));
        break;
      }
    }
  })();

  return {
    async stop() {
      running = false;
      wake?.();
      await loop;
      return { error, stopReason } as const;
    },
  };
}

function armDeadline(
  remainingMs: number | null,
  abortController: AbortController,
) {
  if (remainingMs === null) return null;
  const delayMs = runtimeDeadlineTimerDelayMs(remainingMs);
  if (delayMs === null) {
    // PostgreSQL heartbeat checks remain authoritative for distant deadlines.
    return null;
  }
  if (delayMs === 0) {
    abortController.abort(new Error("Runtime run deadline exceeded."));
    return null;
  }
  const timeout = setTimeout(
    () =>
      abortController.abort(new Error("Runtime run deadline exceeded.")),
    delayMs,
  );
  timeout.unref?.();
  return timeout;
}

export function runtimeDeadlineTimerDelayMs(
  remainingMs: number,
) {
  if (!Number.isFinite(remainingMs)) return null;
  if (remainingMs <= 0) return 0;
  return remainingMs <= MAX_NODE_TIMER_MS ? remainingMs : null;
}

function normalizeDelivery(delivery: RuntimeJobDelivery) {
  if (
    !Number.isSafeInteger(delivery.attempt) ||
    delivery.attempt < 1 ||
    !Number.isSafeInteger(delivery.maxAttempts) ||
    delivery.maxAttempts < 1 ||
    delivery.attempt > delivery.maxAttempts
  ) {
    throw new Error("Runtime queue delivery metadata is invalid");
  }
  return delivery;
}

function normalizeOutcome(value: RunOutcome): RunOutcome {
  if (!isPlainRecord(value) || typeof value.status !== "string") {
    return invalidOutcome();
  }
  if (value.status === "succeeded" || value.status === "cancelled") {
    return hasExactKeys(value, ["status"])
      ? Object.freeze({ status: value.status })
      : invalidOutcome();
  }
  if (
    (value.status === "failed" || value.status === "timedOut") &&
    hasExactKeys(value, ["failure", "status"]) &&
    isRunFailure(value.failure)
  ) {
    return Object.freeze({
      failure: Object.freeze({
        code: normalizeFailureCode(value.failure.code),
        message: value.failure.message.slice(0, 1_024),
        retryable: value.failure.retryable,
      }),
      status: value.status,
    });
  }
  return invalidOutcome();
}

function invalidOutcome(): RunOutcome {
  return failureOutcome({
    code: RUNTIME_RUN_ERROR_CODES.handlerOutcomeInvalid,
    message: "Runtime run handler returned an invalid outcome.",
    retryable: false,
  });
}

function failureFromThrown(error: unknown): RunFailure {
  if (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    "retryable" in error &&
    typeof error.code === "string" &&
    typeof error.retryable === "boolean"
  ) {
    return {
      code: normalizeFailureCode(error.code),
      message:
        "message" in error && typeof error.message === "string"
          ? error.message.slice(0, 1_024)
          : "Runtime run handler failed.",
      retryable: error.retryable,
    };
  }
  return {
    code: RUNTIME_RUN_ERROR_CODES.handlerExecutionFailed,
    message:
      error instanceof Error
        ? error.message.slice(0, 1_024)
        : "Runtime run handler failed.",
    // Retrying an unclassified failure can repeat an external side effect.
    // Handlers must opt in explicitly after establishing idempotency.
    retryable: false,
  };
}

function isRunFailure(value: unknown): value is RunFailure {
  return (
    isPlainRecord(value) &&
    hasExactKeys(value, ["code", "message", "retryable"]) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string" &&
    typeof value.retryable === "boolean"
  );
}

function failureOutcome(failure: RunFailure): RunOutcome {
  return Object.freeze({ failure: Object.freeze(failure), status: "failed" });
}

function hasRetryableFailure(
  outcome: RunOutcome,
): outcome is Extract<RunOutcome, { status: "failed" | "timedOut" }> {
  return (
    (outcome.status === "failed" || outcome.status === "timedOut") &&
    outcome.failure.retryable
  );
}

function normalizeFailureCode(value: string) {
  const code = value.trim().slice(0, 128);
  return /^[A-Z][A-Z0-9_]{0,127}$/.test(code)
    ? code
    : RUNTIME_RUN_ERROR_CODES.handlerExecutionFailed;
}

function isUnknownHandlerError(
  error: unknown,
): error is RuntimeRunHandlerRegistryError {
  return (
    error instanceof RuntimeRunHandlerRegistryError &&
    error.code === RUNTIME_RUN_HANDLER_REGISTRY_ERROR_CODES.unknownKind
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const keys = Reflect.ownKeys(value);
  return (
    keys.length === expected.length &&
    expected.every((key) => keys.includes(key))
  );
}
