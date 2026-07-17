import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  AccessAuditLog,
  LoginAuditLog,
  Permission,
  PlatformUser,
  Tenant,
} from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import {
  PlatformAuditController,
  TenantAuditController,
} from "./audit.controller.js";
import { AuditQueryService } from "./audit-query.service.js";
import { LoginAuditService } from "./login-audit.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature(
      [AccessAuditLog, LoginAuditLog, Permission, PlatformUser, Tenant],
      PLATFORM_DATA_SOURCE,
    ),
  ],
  controllers: [PlatformAuditController, TenantAuditController],
  providers: [AuditQueryService, LoginAuditService],
  exports: [LoginAuditService],
})
export class AuditModule {}
