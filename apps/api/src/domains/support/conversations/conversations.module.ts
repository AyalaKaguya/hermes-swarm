import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Conversation,
  ConversationMessage,
  ConversationMessageFile,
  ConversationParticipant,
  Account,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { NotificationsModule } from "../../../infrastructure/notifications/notifications.module.js";
import { RealtimeModule } from "../../../infrastructure/realtime/realtime.module.js";
import { DatabaseModule } from "../../../common/database/database.module.js";
import { ConversationCapabilityService } from "./conversations.service.js";
import { FilesModule } from "../../../infrastructure/files/files.module.js";

@Module({
  imports: [
    NotificationsModule,
    RealtimeModule,
    DatabaseModule,
    FilesModule,
    TypeOrmModule.forFeature([
      Conversation,
      ConversationMessage,
      ConversationMessageFile,
      ConversationParticipant,
      Account,
      WorkspaceMembership,
    ]),
  ],
  providers: [ConversationCapabilityService],
  exports: [ConversationCapabilityService],
})
export class ConversationsModule {}
