import type { RuntimeDispatchEnvelope } from "@hermes-swarm/agent-sdk";

export const OUTBOX_STORE = Symbol("OUTBOX_STORE");
export const RUNTIME_QUEUE = Symbol("RUNTIME_QUEUE");

export type ClaimedOutboxMessage = Readonly<{
  attempt: number;
  dispatchId: string;
  leaseToken: string;
  runId: string;
  workspaceId: string;
}>;

export interface OutboxStore {
  claimBatch(input: {
    batchSize: number;
    leaseMs: number;
    reconcileMs: number;
  }): Promise<ClaimedOutboxMessage[]>;
  markPublished(message: ClaimedOutboxMessage): Promise<boolean>;
  releaseForRetry(
    message: ClaimedOutboxMessage,
    input: { errorCode: string; retryBackoffMs: number },
  ): Promise<boolean>;
}

export interface RuntimeQueue {
  add(envelope: RuntimeDispatchEnvelope): Promise<void>;
  isReady(): Promise<boolean>;
}
