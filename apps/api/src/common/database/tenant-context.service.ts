import { AsyncLocalStorage } from "node:async_hooks";
import { Injectable, InternalServerErrorException } from "@nestjs/common";
import type { EntityManager, EntityTarget, ObjectLiteral, Repository } from "typeorm";
import type { RequestScopeLevel } from "@hermes-swarm/rbac-api";

export type TenantExecutionContext = {
  manager: EntityManager;
  organizationId: string | null;
  scopeLevel: RequestScopeLevel;
  tenantId: string;
};

@Injectable()
export class TenantContextService {
  private readonly storage = new AsyncLocalStorage<TenantExecutionContext>();

  run<T>(context: TenantExecutionContext, work: () => T): T {
    return this.storage.run(context, work);
  }

  current(required = true) {
    const context = this.storage.getStore() ?? null;
    if (!context && required) {
      throw new InternalServerErrorException(
        "Tenant database context is required for this operation.",
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
