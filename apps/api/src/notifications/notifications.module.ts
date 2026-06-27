import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { NotificationDestination } from "@hermes-swarm/core";
import { TenancyModule } from "../tenancy/tenancy.module.js";
import { NotificationDestinationsController } from "./notification-destinations.controller.js";
import { NotificationDestinationsService } from "./notification-destinations.service.js";

@Module({
  imports: [TenancyModule, TypeOrmModule.forFeature([NotificationDestination])],
  controllers: [NotificationDestinationsController],
  providers: [NotificationDestinationsService],
})
export class NotificationsModule {}
