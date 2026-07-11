import { Injectable } from "@nestjs/common";
import { Ticket } from "@hermes-swarm/core";
import { DataSource } from "typeorm";
import type {
  AccessScopeContext,
  AccessScopeResolver,
  AccessScopeResult,
} from "@hermes-swarm/rbac";

@Injectable()
export class TicketAccessScopeResolver implements AccessScopeResolver {
  constructor(private readonly dataSource: DataSource) {}

  async resolve(context: AccessScopeContext): Promise<AccessScopeResult> {
    const ticketId = context.request.params?.ticketId;
    if (!ticketId) return {};
    const tenantId = context.request.accessPrincipal?.tenantId;
    if (!tenantId) return {};
    const ticket = await this.dataSource.transaction(async (manager) => {
      await manager.query(
        "SELECT set_config('app.tenant_id', $1, true), set_config('app.scope_level', 'tenant', true)",
        [tenantId],
      );
      return manager.getRepository(Ticket).findOne({
        select: {
          organizationId: true,
          requesterUserId: true,
          scope: true,
        },
        where: { id: ticketId, tenantId },
      });
    });
    if (!ticket) return {};
    if (ticket.scope === "tenant") return { scopeLevel: "tenant", tenantId };
    return { organizationId: ticket.organizationId, tenantId };
  }
}
