import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  OrganizationGroupMember,
  PlatformMember,
  RolePermission,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { AuthController } from "./auth.controller.js";
import { AuthSessionService } from "./auth-session.service.js";
import { AuthService } from "./auth.service.js";
import { SettingsModule } from "../settings/settings.module.js";

@Module({
  imports: [
    SettingsModule,
    TypeOrmModule.forFeature([
      OrganizationGroupMember,
      PlatformMember,
      RolePermission,
      User,
      UserOrganization,
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthSessionService],
  exports: [AuthService, AuthSessionService],
})
export class AuthModule {}
