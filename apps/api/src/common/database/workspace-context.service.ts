import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { EntityManager, EntityTarget, ObjectLiteral, Repository } from "typeorm";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";

export type WorkspaceExecutionContext = {
  manager: EntityManager;
  scopeLevel: RequestScopeLevel;
  workspaceId: string;
};

@Injectable()
export class WorkspaceContextService {
  private readonly storage = new AsyncLocalStorage<WorkspaceExecutionContext>();

  run<T>(context: WorkspaceExecutionContext, work: () => T): T {
    return this.storage.run(context, work);
  }

  current(required = true) {
    const context = this.storage.getStore() ?? null;
    if (!context && required) {
      throw new InternalServerErrorException(
        "Workspace database context is required for this operation.",
      );
    }
    return context;
  }

  repository<Entity extends ObjectLiteral>(
    target: EntityTarget<Entity>,
  ): Repository<Entity> {
    return this.current()!.manager.getRepository(target);
  }
}
