import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  OrganizationGroupMember,
  IntegrationToken,
  Role,
  User,
  UserOrganization,
} from "@hermes-swarm/core";
import { MembershipsController } from "./memberships.controller.js";
import { MembershipsService } from "./memberships.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      Organization,
      OrganizationGroupMember,
      IntegrationToken,
      Role,
      User,
      UserOrganization,
    ]),
  ],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
