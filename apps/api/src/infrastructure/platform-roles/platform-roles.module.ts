import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Permission,
  Role,
  RolePermission,
} from "@hermes-swarm/core";
import { PlatformRolesController } from "./platform-roles.controller.js";
import { PlatformRolesService } from "./platform-roles.service.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";

@Module({
  imports: [
    TypeOrmModule.forFeature(
      [Permission, Role, RolePermission],
      PLATFORM_DATA_SOURCE,
    ),
  ],
  controllers: [PlatformRolesController],
  providers: [PlatformRolesService],
  exports: [PlatformRolesService],
})
export class PlatformRolesModule {}
