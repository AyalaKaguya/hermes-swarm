export type WorkspaceJobEnvelope<Payload = unknown> = {
  /** Stable per-workspace key. Re-delivery with the same key is ignored. */
  idempotencyKey: string;
  name: string;
  payload: Payload;
  workspaceId: string;
};

export type WorkspaceJobExecutionResult<Result> =
  | { result: Result; status: "completed" }
  | { status: "already-completed" | "locked" };

export type WorkspaceJobExecutionOptions = {
  idempotencyTtlSeconds?: number;
  lockTtlMs?: number;
};
