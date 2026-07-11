import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Tenant } from "@hermes-swarm/core";
import { PLATFORM_DATA_SOURCE } from "../database/database.constants.js";
import { DatabaseModule } from "../database/database.module.js";
import { TicketsModule } from "../../infrastructure/tickets/tickets.module.js";
import { TenantJobExecutor } from "./tenant-job-executor.service.js";
import { TenantJobFanoutService } from "./tenant-job-fanout.service.js";
import { TicketArchiveJobService } from "./ticket-archive-job.service.js";

@Module({
  imports: [
    DatabaseModule,
    TicketsModule,
    TypeOrmModule.forFeature([Tenant], PLATFORM_DATA_SOURCE),
  ],
  providers: [
    TenantJobExecutor,
    TenantJobFanoutService,
    TicketArchiveJobService,
  ],
  exports: [TenantJobExecutor, TenantJobFanoutService, TicketArchiveJobService],
})
export class JobsModule {}
