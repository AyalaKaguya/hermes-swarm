import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { RealtimeEventBus } from "./realtime-event-bus.service.js";
import { RealtimeService } from "./realtime.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";

@Module({
  imports: [AuthModule, DatabaseModule],
  providers: [RealtimeService, RealtimeEventBus],
  exports: [RealtimeEventBus, RealtimeService],
})
export class RealtimeModule {}
