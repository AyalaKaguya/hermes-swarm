import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Account,
  AccessAuditLog,
  LoginAuditLog,
  Permission,
  Workspace,
} from "@hermes-swarm/core";
import { DatabaseModule } from "../../common/database/database.module.js";
import {
  PlatformAuditController,
  WorkspaceAuditController,
} from "./audit.controller.js";
import { AuditQueryService } from "./audit-query.service.js";
import { LoginAuditService } from "./login-audit.service.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      AccessAuditLog,
      Account,
      LoginAuditLog,
      Permission,
      Workspace,
    ]),
  ],
  controllers: [PlatformAuditController, WorkspaceAuditController],
  providers: [AuditQueryService, LoginAuditService],
  exports: [LoginAuditService],
})
export class AuditModule {}
