import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RuntimeRun, RuntimeRunEvent } from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import { RuntimeRunEventsController } from "./runtime-run-events.controller.js";
import { RuntimeRunEventsService } from "./runtime-run-events.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([RuntimeRun, RuntimeRunEvent]),
  ],
  controllers: [RuntimeRunEventsController],
  providers: [RuntimeRunEventsService],
  exports: [RuntimeRunEventsService],
})
export class RuntimeRunEventsModule {}
