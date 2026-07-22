import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Permission,
  Role,
  RolePermission,
} from "@hermes-swarm/core";
import { PlatformRolesController } from "./platform-roles.controller.js";
import { PlatformRolesService } from "./platform-roles.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([Permission, Role, RolePermission]),
  ],
  controllers: [PlatformRolesController],
  providers: [PlatformRolesService],
  exports: [PlatformRolesService],
})
export class PlatformRolesModule {}
