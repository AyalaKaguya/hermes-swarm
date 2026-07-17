import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  Permission,
  PasswordReset,
  Role,
  RolePermission,
  Tenant,
  TenantApplication,
  User,
  UserOrganization,
  UserOrganizationRole,
  UserTenantRole,
} from "@hermes-swarm/core";
import { TenantApplicationsController, TenantsController } from "./tenants.controller.js";
import { RolesController } from "./roles.controller.js";
import { TenantsService } from "./tenants.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";
import { PLATFORM_DATA_SOURCE } from "../../common/database/database.constants.js";
import { MailModule } from "../mail/mail.module.js";
import { OrganizationsModule } from "../organizations/organizations.module.js";

@Module({
  imports: [
    DatabaseModule,
    MailModule,
    OrganizationsModule,
    TypeOrmModule.forFeature([Tenant]),
    TypeOrmModule.forFeature(
      [
        Permission,
        PasswordReset,
        Role,
        RolePermission,
        Tenant,
        TenantApplication,
        User,
        UserTenantRole,
      ],
      PLATFORM_DATA_SOURCE,
    ),
  ],
  controllers: [RolesController, TenantApplicationsController, TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
