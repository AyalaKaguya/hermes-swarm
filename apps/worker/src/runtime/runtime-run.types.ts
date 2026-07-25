import type {
  RunOutcome,
  RuntimeDispatchEnvelope,
} from "@hermes-swarm/agent-sdk";

export const RUNTIME_RUN_STORE = Symbol("RUNTIME_RUN_STORE");

export const RUNTIME_RUN_ERROR_CODES = Object.freeze({
  attemptsExhausted: "RUNTIME_RUN_ATTEMPTS_EXHAUSTED",
  deadlineExceeded: "RUNTIME_RUN_DEADLINE_EXCEEDED",
  handlerExecutionFailed: "RUNTIME_RUN_HANDLER_EXECUTION_FAILED",
  handlerOutcomeInvalid: "RUNTIME_RUN_HANDLER_OUTCOME_INVALID",
  outboxMissing: "RUNTIME_RUN_OUTBOX_MISSING",
} as const);

export type ClaimedRuntimeRun = Readonly<{
  attempt: number;
  /** Remaining deadline duration calculated from PostgreSQL's clock. */
  deadlineDelayMs: number | null;
  dispatchId: string;
  fencingGeneration: number;
  leaseToken: string;
  maxAttempts: number;
  runId: string;
  runKind: string;
  workspaceId: string;
}>;

export type RuntimeRunClaimResult =
  | Readonly<{ kind: "claimed"; run: ClaimedRuntimeRun }>
  | Readonly<{
      kind: "deferred";
      rearmed: boolean;
      retryAt: Date;
    }>
  | Readonly<{
      kind: "ignored";
      reason:
        | "attempts-exhausted"
        | "cancelled"
        | "missing"
        | "terminal"
        | "timed-out"
        | "waiting";
    }>;

export type RuntimeHeartbeatResult =
  | "active"
  | "cancelling"
  | "stale"
  | "timed-out";

export type RuntimeRunRequeueResult = "finished" | "requeued" | "stale";

export type RuntimeStaleDeliveryRecoveryResult =
  | "ownedElsewhere"
  | "rearmed"
  | "settled";

export interface RuntimeRunStore {
  claim(
    envelope: RuntimeDispatchEnvelope,
    input: {
      leaseMs: number;
      rearmIfDeferred: boolean;
    },
  ): Promise<RuntimeRunClaimResult>;
  finish(run: ClaimedRuntimeRun, outcome: RunOutcome): Promise<boolean>;
  heartbeat(
    run: ClaimedRuntimeRun,
    input: { leaseMs: number },
  ): Promise<RuntimeHeartbeatResult>;
  recoverStaleDelivery(
    run: ClaimedRuntimeRun,
  ): Promise<RuntimeStaleDeliveryRecoveryResult>;
  requeue(
    run: ClaimedRuntimeRun,
    input: {
      errorCode: string;
      rearmOutbox: boolean;
      retryBackoffMs: number;
    },
  ): Promise<RuntimeRunRequeueResult>;
}
