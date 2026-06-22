import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Menu,
  Organization,
  OrganizationSetting,
  Role,
  RolePermission,
  User,
} from "@hermes-swarm/core";
import { TenancyController } from "./tenancy.controller.js";
import { TenancyService } from "./tenancy.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Organization,
      User,
      Role,
      RolePermission,
      OrganizationSetting,
      Menu,
    ]),
  ],
  controllers: [TenancyController],
  providers: [TenancyService],
})
export class TenancyModule {}
