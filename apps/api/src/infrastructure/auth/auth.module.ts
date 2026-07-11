import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  IntegrationToken,
  Organization,
  OrganizationGroupMember,
  PlatformUser,
  Tenant,
  RolePermission,
  User,
  UserOrganization,
  UserTenantRole,
  UserDepartment,
  UserDepartmentRole,
} from "@hermes-swarm/core";
import { AuthController, PlatformAuthController } from "./auth.controller.js";
import { AuthSessionService } from "./auth-session.service.js";
import { AuthService } from "./auth.service.js";
import { SettingsModule } from "../settings/settings.module.js";
import { DatabaseModule } from "../../common/database/database.module.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";

@Module({
  imports: [
    SettingsModule,
    DatabaseModule,
    TypeOrmModule.forFeature([
      OrganizationGroupMember,
      IntegrationToken,
      Organization,
      RolePermission,
      User,
      UserOrganization,
      UserTenantRole,
      UserDepartment,
      UserDepartmentRole,
    ]),
    TypeOrmModule.forFeature([PlatformUser, Tenant], PLATFORM_DATA_SOURCE),
  ],
  controllers: [AuthController, PlatformAuthController],
  providers: [AuthService, AuthSessionService],
  exports: [AuthService, AuthSessionService],
})
export class AuthModule {}
