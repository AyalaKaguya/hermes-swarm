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
  providers: [TenancyService],
  exports: [TenancyService],
})
export class TenancyModule {}
