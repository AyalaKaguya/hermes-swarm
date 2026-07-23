import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Account,
  IntegrationToken,
  PlatformMembership,
  Workspace,
  RolePermission,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { AuthController } from "./auth.controller.js";
import { AuthSessionEphemeralService } from "./auth-session-ephemeral.service.js";
import { AuthSessionRecordsService } from "./auth-session-records.service.js";
import { AuthSessionService } from "./auth-session.service.js";
import { AuthSessionStoreService } from "./auth-session-store.service.js";
import { AuthService } from "./auth.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";
import { WorkspaceLoginResolverService } from "./workspace-login-resolver.service.js";
import { SettingsModule } from "../settings/settings.module.js";
import { AuditModule } from "../audit/audit.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      IntegrationToken,
      RolePermission,
      Account,
      WorkspaceMembership,
      PlatformMembership,
      Workspace,
    ]),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthSessionEphemeralService,
    AuthSessionRecordsService,
    AuthSessionService,
    AuthSessionStoreService,
    WorkspaceLoginResolverService,
  ],
  exports: [AuthService, AuthSessionService, WorkspaceLoginResolverService],
})
export class AuthModule {}
