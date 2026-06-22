import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Menu,
  Organization,
  Role,
  RolePermission,
  Tenant,
  TenantSetting,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { TenancyController } from "./tenancy.controller.js";
import { TenancyService } from "./tenancy.service.js";

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tenant,
      Organization,
      User,
      UserOrganization,
      Role,
      RolePermission,
      TenantSetting,
      Menu,
    ]),
  ],
  controllers: [TenancyController],
  providers: [TenancyService],
})
export class TenancyModule {}
