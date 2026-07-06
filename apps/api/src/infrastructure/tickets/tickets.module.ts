import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  PlatformMember,
  RolePermission,
  Ticket,
  TicketMessage,
  UserOrganization,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import { ConversationsModule } from "../conversations/conversations.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { TicketConversationAccessResolver } from "./ticket-conversation-access.resolver.js";
import { TicketsController } from "./tickets.controller.js";
import { TicketAccessScopeResolver } from "./ticket-access-scope.resolver.js";
import { TicketsService } from "./tickets.service.js";

@Module({
  imports: [
    AuthModule,
    ConversationsModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      PlatformMember,
      RolePermission,
      Ticket,
      TicketMessage,
      UserOrganization,
    ]),
  ],
  controllers: [TicketsController],
  providers: [
    TicketAccessScopeResolver,
    TicketConversationAccessResolver,
    TicketsService,
  ],
  exports: [TicketsService],
})
export class TicketsModule {}
