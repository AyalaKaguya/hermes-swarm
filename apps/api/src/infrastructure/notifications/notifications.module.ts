import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { UserNotification } from "@hermes-swarm/core";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";
import { DatabaseModule } from "../../common/database/database.module.js";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    RealtimeModule,
    TypeOrmModule.forFeature([UserNotification]),
  ],
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
