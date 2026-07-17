import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  Permission,
  Role,
  RolePermission,
  Ticket,
  UserOrganization,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";
import { OrganizationRolesController } from "./organization-roles.controller.js";
import { OrganizationRolesService } from "./organization-roles.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      Organization,
      Permission,
      Role,
      RolePermission,
      Ticket,
      UserOrganization,
      UserOrganizationRole,
    ]),
  ],
  controllers: [OrganizationRolesController, OrganizationsController],
  providers: [OrganizationRolesService, OrganizationsService],
  exports: [OrganizationRolesService, OrganizationsService],
})
export class OrganizationsModule {}
