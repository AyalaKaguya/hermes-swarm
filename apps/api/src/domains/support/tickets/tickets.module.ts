import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  RolePermission,
  Ticket,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { AuthModule } from "../../../infrastructure/auth/auth.module.js";
import { ConversationsModule } from "../conversations/conversations.module.js";
import { SettingsModule } from "../../../infrastructure/settings/settings.module.js";
import { DatabaseModule } from "../../../common/database/database.module.js";
import { TicketConversationAccessResolver } from "./ticket-conversation-access.resolver.js";
import { TicketsController } from "./tickets.controller.js";
import { TicketsService } from "./tickets.service.js";

@Module({
  imports: [
    AuthModule,
    ConversationsModule,
    DatabaseModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      RolePermission,
      Ticket,
      WorkspaceMembership,
    ]),
  ],
  controllers: [TicketsController],
  providers: [
    TicketConversationAccessResolver,
    TicketsService,
  ],
  exports: [TicketsService],
})
export class TicketsModule {}
