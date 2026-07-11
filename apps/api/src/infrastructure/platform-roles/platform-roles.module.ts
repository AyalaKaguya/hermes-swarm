import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Permission,
  PlatformRole,
  PlatformRolePermission,
} from "@hermes-swarm/core";
import { PlatformRolesController } from "./platform-roles.controller.js";
import { PlatformRolesService } from "./platform-roles.service.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [Permission, PlatformRole, PlatformRolePermission],
      PLATFORM_DATA_SOURCE,
    ),
  ],
  controllers: [PlatformRolesController],
  providers: [PlatformRolesService],
  exports: [PlatformRolesService],
})
export class PlatformRolesModule {}
