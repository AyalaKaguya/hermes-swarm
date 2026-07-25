import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable } from "@nestjs/common";
import type { RunHandlerContext, RunLease } from "@hermes-swarm/agent-sdk";
import type { ClaimedRuntimeRun } from "./runtime-run.types.js";

export type TrustedRunContext = Readonly<{
  dispatchId: string;
  lease: RunLease;
  runKind: string;
}>;

@Injectable()
export class TrustedRunContextService {
  private readonly storage = new AsyncLocalStorage<TrustedRunContext>();

  current(required = true): TrustedRunContext | undefined {
    const context = this.storage.getStore();
    if (!context && required) {
      throw new Error("Trusted runtime context is unavailable");
    }
    return context;
  }

  run<T>(
    claimed: ClaimedRuntimeRun,
    signal: AbortSignal,
    work: (context: RunHandlerContext) => Promise<T>,
  ): Promise<T> {
    const lease = Object.freeze({
      fencingGeneration: claimed.fencingGeneration,
      runId: claimed.runId,
      workspaceId: claimed.workspaceId,
    });
    const trusted = Object.freeze({
      dispatchId: claimed.dispatchId,
      lease,
      runKind: claimed.runKind,
    });
    const handlerContext = Object.freeze({ lease, signal });
    return this.storage.run(trusted, () => work(handlerContext));
  }
}
