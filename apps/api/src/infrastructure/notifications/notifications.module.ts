import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  NotificationDestination,
  UserNotification,
  UserOrganization,
} from "@hermes-swarm/core";
import { NotificationDestinationsController } from "./notification-destinations.controller.js";
import { NotificationDestinationsService } from "./notification-destinations.service.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { AuthModule } from "../auth/auth.module.js";
import { RealtimeModule } from "../realtime/realtime.module.js";

@Module({
  imports: [
    AuthModule,
    RealtimeModule,
    TypeOrmModule.forFeature([
      NotificationDestination,
      UserNotification,
      UserOrganization,
    ]),
  ],
  controllers: [NotificationDestinationsController, NotificationsController],
  providers: [NotificationDestinationsService, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
