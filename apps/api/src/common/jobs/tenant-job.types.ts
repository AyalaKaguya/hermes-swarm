export type TenantJobEnvelope<Payload = unknown> = {
  /** Stable per-tenant key. Re-delivery with the same key is ignored. */
  idempotencyKey: string;
  name: string;
  payload: Payload;
  tenantId: string;
};

export type TenantJobExecutionResult<Result> =
  | { result: Result; status: "completed" }
  | { status: "already-completed" | "locked" };

export type TenantJobExecutionOptions = {
  idempotencyTtlSeconds?: number;
  lockTtlMs?: number;
};
