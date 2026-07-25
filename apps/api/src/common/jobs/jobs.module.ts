import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { RuntimeOutboxMessage, RuntimeRun, Workspace } from "@hermes-swarm/core";
import { DatabaseModule } from "../database/database.module.js";
import { RuntimeSubmissionService } from "./runtime-submission.service.js";
import { WorkspaceJobExecutor } from "./workspace-job-executor.service.js";
import { WorkspaceJobFanoutService } from "./workspace-job-fanout.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([RuntimeOutboxMessage, RuntimeRun, Workspace]),
  ],
  providers: [
    RuntimeSubmissionService,
    WorkspaceJobExecutor,
    WorkspaceJobFanoutService,
  ],
  exports: [
    RuntimeSubmissionService,
    WorkspaceJobExecutor,
    WorkspaceJobFanoutService,
  ],
})
export class JobsModule {}
