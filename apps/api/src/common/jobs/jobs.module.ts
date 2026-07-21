import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Workspace } from "@hermes-swarm/core";
import { PLATFORM_DATA_SOURCE } from "../database/database.constants.js";
import { DatabaseModule } from "../database/database.module.js";
import { WorkspaceJobExecutor } from "./workspace-job-executor.service.js";
import { WorkspaceJobFanoutService } from "./workspace-job-fanout.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Workspace], PLATFORM_DATA_SOURCE),
  ],
  providers: [WorkspaceJobExecutor, WorkspaceJobFanoutService],
  exports: [WorkspaceJobExecutor, WorkspaceJobFanoutService],
})
export class JobsModule {}
