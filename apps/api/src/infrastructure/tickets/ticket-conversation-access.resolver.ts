import { Inject, Injectable, Optional } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import {
  FEATURE_SETTING_KEYS,
  RolePermission,
  Ticket,
  UserOrganization,
  UserTenantRole,
} from "@hermes-swarm/core";
import { In, Repository } from "typeorm";
import type {
  ConversationAccessResolver,
  ConversationSource,
} from "../conversations/conversation-access-resolver.js";
import { ConversationCapabilityService } from "../conversations/conversations.service.js";
import { SettingsService } from "../settings/settings.service.js";
import { TenantContextService } from "../../common/database/tenant-context.service.js";

const ORGANIZATION_TICKET_HANDLING_FEATURE_KEY =
  FEATURE_SETTING_KEYS.ticketingHandling;
const ORGANIZATION_TICKET_HANDLE_PERMISSION =
  "ticket.conversation.handle:organization";
const TENANT_TICKET_HANDLE_PERMISSION = "ticket.tenant_conversation.handle:tenant";

@Injectable()
export class TicketConversationAccessResolver implements ConversationAccessResolver {
  constructor(
    @InjectRepository(Ticket)
    private readonly ticketRepository: Repository<Ticket>,
    @InjectRepository(UserOrganization)
    private readonly membershipRepository: Repository<UserOrganization>,
    @InjectRepository(UserTenantRole)
    private readonly userTenantRoleRepository: Repository<UserTenantRole>,
    @InjectRepository(RolePermission)
    private readonly rolePermissionRepository: Repository<RolePermission>,
    @Inject(ConversationCapabilityService)
    private readonly conversationsService: ConversationCapabilityService,
    @Inject(SettingsService)
    private readonly settingsService: SettingsService,
    @Optional()
    private readonly tenantContext?: TenantContextService,
  ) {}

  async canRead(userId: string, source: ConversationSource) {
    const ticket = await this.findTicket(source);
    if (!ticket) return false;
    if (
      ticket.requesterUserId === userId ||
      ticket.assigneeUserId === userId ||
      ticket.participantUserIds?.includes(userId) ||
      (await this.conversationsService.isParticipant(source, userId))
    ) {
      return true;
    }
    if (ticket.scope === "tenant") {
      return this.canHandleTenantTickets(source.tenantId, userId);
    }
    return ticket.organizationId
      ? this.canHandleOrganizationTickets(source.tenantId, userId, ticket.organizationId)
      : false;
  }

  async canWrite(userId: string, source: ConversationSource) {
    return this.canRead(userId, source);
  }

  buildNotificationPayload(input: Parameters<NonNullable<ConversationAccessResolver["buildNotificationPayload"]>>[0]) {
    return input.kind === "mention"
      ? {
          body: input.message.body,
          title: `有人在工单中提到了你：${input.source.subject}`,
        }
      : {
          body: input.message.body,
          title: `工单新消息：${input.source.subject}`,
        };
  }

  private findTicket(source: ConversationSource) {
    if (source.sourceType !== "ticket") return null;
    return this.repository(Ticket, this.ticketRepository).findOne({
      where: { id: source.sourceId, tenantId: source.tenantId },
    });
  }

  private async canHandleOrganizationTickets(
    tenantId: string,
    userId: string,
    organizationId: string,
  ) {
    if (!(await this.isOrganizationTicketHandlingEnabled(organizationId))) {
      return false;
    }
    const membership = await this.repository(
      UserOrganization,
      this.membershipRepository,
    ).findOne({
      where: { organizationId, status: "active", tenantId, userId },
    });
    return membership?.roleId
      ? this.roleHasPermission(
          membership.roleId,
          ORGANIZATION_TICKET_HANDLE_PERMISSION,
          tenantId,
        )
      : false;
  }

  private async isOrganizationTicketHandlingEnabled(organizationId: string) {
    const value = await this.settingsService.getOrganizationValue(
      organizationId,
      ORGANIZATION_TICKET_HANDLING_FEATURE_KEY,
      "true",
    );
    return value !== "false";
  }

  private async canHandleTenantTickets(tenantId: string, userId: string) {
    const assignments = await this.repository(
      UserTenantRole,
      this.userTenantRoleRepository,
    ).find({
      where: { tenantId, userId },
    });
    if (assignments.length === 0) return false;
    return Boolean(
      await this.repository(RolePermission, this.rolePermissionRepository).findOne({
        where: {
          enabled: true,
          permission: TENANT_TICKET_HANDLE_PERMISSION,
          roleId: In(assignments.map((assignment) => assignment.roleId)),
          tenantId,
        },
      }),
    );
  }

  private async roleHasPermission(roleId: string, permission: string, tenantId: string) {
    return Boolean(
      await this.repository(RolePermission, this.rolePermissionRepository).findOne({
        where: {
          enabled: true,
          permission,
          roleId,
          tenantId,
        },
      }),
    );
  }

  private repository<Entity extends import("typeorm").ObjectLiteral>(
    target: import("typeorm").EntityTarget<Entity>,
    fallback: Repository<Entity>,
  ) {
    return this.tenantContext?.current(false)?.manager.getRepository(target) ?? fallback;
  }
}
