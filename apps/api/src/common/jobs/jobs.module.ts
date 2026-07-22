import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Workspace } from "@hermes-swarm/core";
import { DatabaseModule } from "../database/database.module.js";
import { WorkspaceJobExecutor } from "./workspace-job-executor.service.js";
import { WorkspaceJobFanoutService } from "./workspace-job-fanout.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Workspace]),
  ],
  providers: [WorkspaceJobExecutor, WorkspaceJobFanoutService],
  exports: [WorkspaceJobExecutor, WorkspaceJobFanoutService],
})
export class JobsModule {}
