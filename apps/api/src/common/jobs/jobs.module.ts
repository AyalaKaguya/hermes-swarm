import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import { Tenant } from "@hermes-swarm/core";
import { PLATFORM_DATA_SOURCE } from "../database/database.constants.js";
import { DatabaseModule } from "../database/database.module.js";
import { TenantJobExecutor } from "./tenant-job-executor.service.js";
import { TenantJobFanoutService } from "./tenant-job-fanout.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([Tenant], PLATFORM_DATA_SOURCE),
  ],
  providers: [TenantJobExecutor, TenantJobFanoutService],
  exports: [TenantJobExecutor, TenantJobFanoutService],
})
export class JobsModule {}
