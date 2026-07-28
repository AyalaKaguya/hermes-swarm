/** Namespaced and extensible, for example `agent.graph` or `analytics.query`. */
export type RuntimeRunKind = `${string}.${string}`;

/**
 * A PostgreSQL-backed execution lease. The fencing generation must increase
 * on every successful re-claim so a stale worker cannot commit an outcome.
 */
export type RunLease = Readonly<{
  fencingGeneration: number;
  runId: string;
  workspaceId: string;
}>;

export type RunFailure = Readonly<{
  code: string;
  message: string;
  retryable: boolean;
}>;

export type RunOutcome =
  | Readonly<{ status: "succeeded" }>
  | Readonly<{ status: "cancelled" }>
  | Readonly<{ failure: RunFailure; status: "failed" | "timedOut" }>;

/** Trusted context reconstructed from persisted Run state, never the queue. */
export type RunHandlerContext = Readonly<{
  lease: RunLease;
  signal: AbortSignal;
}>;

export interface RunHandler<
  TKind extends RuntimeRunKind = RuntimeRunKind,
> {
  readonly kind: TKind;
  execute(context: RunHandlerContext): Promise<RunOutcome>;
}
