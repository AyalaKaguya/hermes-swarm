import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  IntegrationToken,
  RolePermission,
  WorkspaceMembership,
} from "@hermes-swarm/core";
import { AuthModule } from "../auth/auth.module.js";
import { DatabaseModule } from "../../common/database/database.module.js";
import { IntegrationTokensController } from "./integration-tokens.controller.js";
import { IntegrationTokensService } from "./integration-tokens.service.js";

@Module({
  imports: [
    AuthModule,
    DatabaseModule,
    TypeOrmModule.forFeature([
      IntegrationToken,
      RolePermission,
      WorkspaceMembership,
    ]),
  ],
  controllers: [IntegrationTokensController],
  providers: [IntegrationTokensService],
})
export class IntegrationsModule {}
