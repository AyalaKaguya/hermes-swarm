import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  Permission,
  Role,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";
import { SettingsModule } from "../settings/settings.module.js";

@Module({
  imports: [
    SettingsModule,
    TypeOrmModule.forFeature([
      Organization,
      Permission,
      Role,
      RolePermission,
      UserOrganization,
    ]),
  ],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
