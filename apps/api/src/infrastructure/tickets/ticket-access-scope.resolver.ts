import { Injectable } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Ticket } from "@hermes-swarm/core";
import { Repository } from "typeorm";
import type {
  AccessScopeContext,
  AccessScopeResolver,
  AccessScopeResult,
} from "@hermes-swarm/rbac";

@Injectable()
export class TicketAccessScopeResolver implements AccessScopeResolver {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
  ) {}

  async resolve(context: AccessScopeContext): Promise<AccessScopeResult> {
    const ticketId = context.request.params?.ticketId;
    if (!ticketId) return {};
    const ticket = await this.ticketRepository.findOne({
      select: {
        organizationId: true,
        requesterUserId: true,
        scope: true,
      },
      where: { id: ticketId },
    });
    if (!ticket) return {};
    if (ticket.scope === "platform") return {};
    return { organizationId: ticket.organizationId };
  }
}
