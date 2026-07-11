import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Department,
  IntegrationToken,
  Organization,
  Permission,
  RolePermission,
  User,
  UserDepartment,
  UserDepartmentRole,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import {
  DepartmentIntegrationTokensController,
  IntegrationTokensController,
  OrganizationIntegrationTokensController,
} from "./integration-tokens.controller.js";
import { IntegrationTokensService } from "./integration-tokens.service.js";

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      Department,
      IntegrationToken,
      Organization,
      Permission,
      RolePermission,
      User,
      UserDepartment,
      UserDepartmentRole,
      UserOrganization,
      UserOrganizationRole,
      UserTenantRole,
    ]),
  ],
  controllers: [
    DepartmentIntegrationTokensController,
    IntegrationTokensController,
    OrganizationIntegrationTokensController,
  ],
  providers: [IntegrationTokensService],
})
export class IntegrationsModule {}
