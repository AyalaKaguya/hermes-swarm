import { Module } from "@nestjs/common";
import { TypeOrmModule } from "@nestjs/typeorm";
import {
  Organization,
  Role,
  User,
  UserOrganization,
  UserOrganizationRole,
} from "@hermes-swarm/core";
import { MembershipsController } from "./memberships.controller.js";
import { MembershipsService } from "./memberships.service.js";
import { DatabaseModule } from "../../common/database/database.module.js";

@Module({
  imports: [
    DatabaseModule,
    TypeOrmModule.forFeature([
      Organization,
      Role,
      User,
      UserOrganization,
      UserOrganizationRole,
    ]),
  ],
  controllers: [MembershipsController],
  providers: [MembershipsService],
  exports: [MembershipsService],
})
export class MembershipsModule {}
