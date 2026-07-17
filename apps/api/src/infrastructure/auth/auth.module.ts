import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  IntegrationToken,
  Organization,
  PlatformUser,
  Tenant,
  RolePermission,
  User,
  UserOrganization,
  UserTenantRole,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { AuthController, PlatformAuthController } from "./auth.controller.js";
import { AuthSessionService } from "./auth-session.service.js";
import { AuthService } from "./auth.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { TenantLoginResolverService } from "./tenant-login-resolver.service.js";
import { SettingsModule } from "../settings/settings.module.js";
import { AuditModule } from "../audit/audit.module.js";

@Module({
  imports: [
    DatabaseModule,
    AuditModule,
    SettingsModule,
    TypeOrmModule.forFeature([
      IntegrationToken,
      Organization,
      RolePermission,
      User,
      UserOrganization,
      UserTenantRole,
      UserOrganizationRole,
    ]),
    TypeOrmModule.forFeature([PlatformUser, Tenant], PLATFORM_DATA_SOURCE),
  ],
  controllers: [AuthController, PlatformAuthController],
  providers: [AuthService, AuthSessionService, TenantLoginResolverService],
  exports: [AuthService, AuthSessionService, TenantLoginResolverService],
})
export class AuthModule {}
