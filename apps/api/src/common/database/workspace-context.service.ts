import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";

export type WorkspaceExecutionContext = {
  scopeLevel: RequestScopeLevel;
  workspaceId: string;
};

@Injectable()
export class WorkspaceContextService {
  private readonly storage = new AsyncLocalStorage<WorkspaceExecutionContext>();

  run<T>(context: WorkspaceExecutionContext, work: () => T): T {
    return this.storage.run(context, work);
  }

  current(): WorkspaceExecutionContext;
  current(required: false): WorkspaceExecutionContext | null;
  current(required = true): WorkspaceExecutionContext | null {
    const context = this.storage.getStore() ?? null;
    if (!context && required) {
      throw new InternalServerErrorException(
        "Workspace context is required for this operation.",
      );
    }
    return context;
  }
}
