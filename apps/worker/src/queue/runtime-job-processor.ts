export const RUNTIME_JOB_PROCESSOR = Symbol("RUNTIME_JOB_PROCESSOR");

export type RuntimeJobDelivery = Readonly<{
  attempt: number;
  maxAttempts: number;
}>;

export interface RuntimeJobProcessor {
  /** Signals handlers that are still active after the graceful drain deadline. */
  abortActive(): void;
  process(value: unknown, delivery?: RuntimeJobDelivery): Promise<void>;
}
