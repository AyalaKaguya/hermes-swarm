import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Group,
  Menu,
  Organization,
  OrganizationSetting,
  Role,
  RolePermission,
  SystemSetting,
  User,
} from "@hermes-swarm/core";
import { GroupsController } from "./groups.controller.js";
import { GroupsService } from "./groups.service.js";
import { TenancyService } from "./tenancy.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Group,
      Menu,
      Organization,
      OrganizationSetting,
      Role,
      RolePermission,
      SystemSetting,
      User,
    ]),
  ],
  controllers: [GroupsController],
  providers: [GroupsService, TenancyService],
  exports: [GroupsService, TenancyService],
})
export class TenancyModule {}
