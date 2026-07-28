export const WORKER_CONSUMER = Symbol("WORKER_CONSUMER");

export interface WorkerConsumerControl {
  drain(timeoutMs: number): Promise<void>;
  isReady(): Promise<boolean>;
  pause(): Promise<void>;
  start(): Promise<void>;
}
