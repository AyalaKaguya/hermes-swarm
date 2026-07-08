import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  IntegrationToken,
  Organization,
  Permission,
  PlatformMember,
  RolePermission,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import {
  IntegrationTokensController,
  OrganizationIntegrationTokensController,
  PlatformIntegrationTokensController,
} from "./integration-tokens.controller.js";
import { IntegrationTokensService } from "./integration-tokens.service.js";

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      IntegrationToken,
      Organization,
      Permission,
      PlatformMember,
      RolePermission,
      User,
      UserOrganization,
    ]),
  ],
  controllers: [
    IntegrationTokensController,
    OrganizationIntegrationTokensController,
    PlatformIntegrationTokensController,
  ],
  providers: [IntegrationTokensService],
})
export class IntegrationsModule {}
