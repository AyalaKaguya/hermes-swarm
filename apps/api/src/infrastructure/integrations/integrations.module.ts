import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  IntegrationToken,
  Permission,
  PlatformMember,
  RolePermission,
  UserOrganization,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import { IntegrationTokensController } from "./integration-tokens.controller.js";
import { IntegrationTokensService } from "./integration-tokens.service.js";

@Module({
  imports: [
    AuthModule,
    TypeOrmModule.forFeature([
      IntegrationToken,
      Permission,
      PlatformMember,
      RolePermission,
      UserOrganization,
    ]),
  ],
  controllers: [IntegrationTokensController],
  providers: [IntegrationTokensService],
})
export class IntegrationsModule {}
