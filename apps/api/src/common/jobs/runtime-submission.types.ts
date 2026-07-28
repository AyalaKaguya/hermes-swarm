import type { RuntimeOutboxMessage, RuntimeRun } from "@hermes-swarm/core";

export const DEFAULT_RUNTIME_RUN_MAX_ATTEMPTS = 3;
export const DEFAULT_RUNTIME_OUTBOX_MAX_ATTEMPTS = 20;

export const RUNTIME_SUBMISSION_CONFLICT_CODE =
  "RUNTIME_SUBMISSION_IDEMPOTENCY_CONFLICT" as const;
export const RUNTIME_SUBMISSION_INVALID_CODE =
  "RUNTIME_SUBMISSION_INVALID" as const;
export const RUNTIME_SUBMISSION_INVARIANT_CODE =
  "RUNTIME_SUBMISSION_INVARIANT_VIOLATION" as const;
export const RUNTIME_CANCELLATION_NOT_FOUND_CODE =
  "RUNTIME_CANCELLATION_NOT_FOUND" as const;

export type RuntimeSubmissionInput = Readonly<{
  availableAt?: Date;
  correlationId?: string | null;
  deadlineAt?: Date | null;
  idempotencyKey: string;
  maxAttempts?: number;
  requestDigest: string;
  runKind: string;
}>;

export type RuntimeSubmissionResult = Readonly<{
  deduplicated: boolean;
  outbox: RuntimeOutboxMessage;
  run: RuntimeRun;
}>;

/** Indistinguishable result for an unknown run or one outside the workspace. */
export class RuntimeCancellationNotFoundError extends Error {
  readonly code = RUNTIME_CANCELLATION_NOT_FOUND_CODE;

  constructor() {
    super("Runtime run is unavailable for cancellation.");
    this.name = "RuntimeCancellationNotFoundError";
  }
}

/** Stable internal error: a key cannot be reused for a different request. */
export class RuntimeSubmissionConflictError extends Error {
  readonly code = RUNTIME_SUBMISSION_CONFLICT_CODE;

  constructor() {
    super("Runtime submission idempotency key conflicts with an existing request.");
    this.name = "RuntimeSubmissionConflictError";
  }
}

/** Stable fail-closed error for invalid trusted runtime input or context. */
export class RuntimeSubmissionValidationError extends Error {
  readonly code = RUNTIME_SUBMISSION_INVALID_CODE;

  constructor() {
    super("Runtime submission input or transaction context is invalid.");
    this.name = "RuntimeSubmissionValidationError";
  }
}

/** Indicates durable state that could not have been produced atomically. */
export class RuntimeSubmissionInvariantError extends Error {
  readonly code = RUNTIME_SUBMISSION_INVARIANT_CODE;

  constructor() {
    super("Runtime submission durable state is incomplete.");
    this.name = "RuntimeSubmissionInvariantError";
  }
}
