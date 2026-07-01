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
import { AuthService } from "./auth.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrganizationGroupMember,
      PlatformMember,
      RolePermission,
      User,
      UserOrganization,
    ]),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
